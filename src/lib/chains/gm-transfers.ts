import { formatUnits, keccak256, numberToHex, toHex } from "viem";
import type { BlockWindow } from "./blocks";
// Только тип: import type стирается при сборке, поэтому server-only
// из coingecko.ts сюда не приезжает и модуль остаётся чистым.
import type { PriceSeries } from "@/lib/prices/coingecko";

/**
 * Чистое ядро поиска операций с GM-токеном (Фаза 8, S8.5).
 *
 * Здесь нет ни сети, ни viem-клиента, ни `server-only`: всё, что зависит от
 * провайдера, живёт в gm-search.ts. Разделение не косметическое — вся
 * содержательная часть задачи (что считать покупкой, как подбирать окно
 * запроса, как читать жалобу узла) проверяется без единого мока сети.
 *
 * Почему ERC-20 Transfer, а не события GMX: покупка GM (deposit) минтит токен
 * получателю, продажа (withdrawal) сжигает. Формат `EventLog1` у GMX
 * версионнозависим, `Transfer(address,address,uint256)` — нет.
 */

/** Глубина поиска — решение владельца (docs/09 §S8.5). */
export const GM_SEARCH_DAYS = 14;

/**
 * Сколько строк показывается.
 *
 * Не «последняя покупка»: по стратегии на каждом уровне GM продаются и тут же
 * откупаются (§5), так что покупок в цикле несколько, и последняя из них —
 * вход последнего слоя, а не точка отсчёта. Одна цифра была бы неверной
 * в большинстве случаев.
 */
export const GM_ROW_LIMIT = 10;

const SECONDS_PER_DAY = 86_400n;

/** keccak256("Transfer(address,address,uint256)") — topic0 любого ERC-20. */
export const TRANSFER_TOPIC = keccak256(
  toHex("Transfer(address,address,uint256)"),
);

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_TOPIC = `0x${"0".repeat(64)}`;

/** Адрес как topic: 12 нулевых байт слева, 20 байт адреса справа. */
export function addressTopic(addr: string): string {
  const hex = addr.toLowerCase().replace(/^0x/, "");
  return `0x${hex.padStart(64, "0")}`;
}

/** Окно поиска в секундах: [сейчас − 14 суток, сейчас]. */
export function searchWindowSec(nowSec: bigint): {
  fromSec: bigint;
  toSec: bigint;
} {
  return { fromSec: nowSec - BigInt(GM_SEARCH_DAYS) * SECONDS_PER_DAY, toSec: nowSec };
}

/** Направление операции с точки зрения владельца GM. */
export type GmTransferKind = "buy" | "sell";

/**
 * Покупка, продажа или ничего.
 *
 * Перевод GM с кошелька на кошелёк (`wallet → wallet`) осознанно отбрасывается:
 * это не операция с пулом, количество GM у стратегии от него не меняется, а на
 * экране такая строка выглядела бы покупкой и подставила бы в точку отсчёта
 * цену чужого события.
 */
export function classifyTransfer(args: {
  from: string;
  to: string;
  wallet: string;
}): GmTransferKind | null {
  const from = args.from.toLowerCase();
  const to = args.to.toLowerCase();
  const wallet = args.wallet.toLowerCase();
  const zero = ZERO_ADDRESS;

  if (from === zero && to === zero) return null;
  if (from === zero) return to === wallet ? "buy" : null;
  if (to === zero) return from === wallet ? "sell" : null;
  return null;
}

/** Сторона кошелька в запросе к Alchemy: получение или отправка. */
export type TransferSide = "in" | "out";

export interface TransferQuery {
  gmToken: string;
  wallet: string;
  fromBlock: bigint;
  toBlock: bigint;
}

/**
 * Параметры `alchemy_getAssetTransfers` для одной стороны.
 *
 * Нулевой адрес в фильтр НЕ кладётся, хотя соблазн есть: покупку можно было бы
 * спросить как `fromAddress: 0x0, toAddress: wallet`. Но тогда классификация
 * зависела бы от того, как Alchemy индексирует нулевой адрес, и разошлась бы
 * с запасным путём. Фильтруем по стороне кошелька, разбираем `classifyTransfer` —
 * одинаково для обоих путей.
 */
export function assetTransfersParams(
  q: TransferQuery,
  side: TransferSide,
): Record<string, unknown> {
  return {
    category: ["erc20"],
    contractAddresses: [q.gmToken.toLowerCase()],
    ...(side === "in"
      ? { toAddress: q.wallet.toLowerCase() }
      : { fromAddress: q.wallet.toLowerCase() }),
    order: "desc",
    maxCount: "0x64",
    withMetadata: true,
    fromBlock: numberToHex(q.fromBlock),
    toBlock: numberToHex(q.toBlock),
  };
}

/**
 * Фильтр `eth_getLogs` для запасного пути.
 *
 * Оба индексированных места — «либо ноль, либо кошелёк»: это ровно mint
 * и burn плюс отсеиваемый `classifyTransfer` перевод кошелька самому себе.
 */
export function logsFilter(q: TransferQuery): Record<string, unknown> {
  const wallet = addressTopic(q.wallet);
  return {
    address: q.gmToken.toLowerCase(),
    topics: [
      TRANSFER_TOPIC,
      [ZERO_TOPIC, wallet],
      [ZERO_TOPIC, wallet],
    ],
    fromBlock: numberToHex(q.fromBlock),
    toBlock: numberToHex(q.toBlock),
  };
}

// --- Подбор окна eth_getLogs ---

/**
 * Сколько ИСТОРИИ (в секундах) просить первым запросом.
 *
 * Величина задана во времени, а не в блоках, и это главное. На Arbitrum
 * четыре блока в секунду: окно в 10 000 блоков, разумное для Ethereum,
 * покрывает здесь сорок минут, и поиск за две недели выродился бы в сотни
 * запросов. Сколько это блоков — считается из двух реальных проб, а не из
 * таблицы «сеть → время блока», которая устаревает молча (см. шапку blocks.ts).
 */
export const TARGET_WINDOW_SEC = 86_400n;

/** Ниже этого окно бессмысленно: узел не умеет отвечать на такой вопрос. */
export const MIN_LOG_SPAN = 1_000n;
/** Выше — заведомый отказ у любого провайдера. */
export const MAX_LOG_SPAN = 2_000_000n;

/**
 * Размер первого окна в блоках, выведенный из двух проб.
 *
 * `BlockWindow` уже содержит и блоки, и их время — второй раз в сеть за этим
 * ходить не нужно. Вырожденные пробы (одинаковое время или один блок) дают
 * минимальное окно: оно удвоится на первом же успехе.
 */
export function initialLogSpan(window: BlockWindow): bigint {
  const dBlocks = window.latest.block - window.from.block;
  const dSecs = window.latest.timestamp - window.from.timestamp;
  if (dBlocks <= 0n || dSecs <= 0n) return MIN_LOG_SPAN;

  const span = (dBlocks * TARGET_WINDOW_SEC) / dSecs;
  if (span < MIN_LOG_SPAN) return MIN_LOG_SPAN;
  return span > MAX_LOG_SPAN ? MAX_LOG_SPAN : span;
}

/** Потолок запросов на скан. Дальше отвечаем `partial`, а не молчим дольше. */
export const MAX_LOG_REQUESTS = 24;

export interface LogScanState {
  /** Верхняя граница СЛЕДУЮЩЕГО окна; идём назад от головы. */
  cursor: bigint;
  /** Нижняя граница всего поиска — блок 14-суточной давности. */
  floor: bigint;
  span: bigint;
  requests: number;
  /** Абсолютный момент, после которого скан обязан остановиться. */
  deadlineMs: number;
}

/** Чем кончился очередной запрос. `message` — текст жалобы узла. */
export interface LogScanOutcome {
  kind: "ok" | "tooMany" | "timeout";
  message?: string;
  nowMs: number;
}

export type LogScanDone = "reached" | "budget" | "deadline" | "unsupported";

export type LogScanStep =
  | { done: LogScanDone; reachedBlock: bigint }
  | { state: LogScanState; range: { fromBlock: bigint; toBlock: bigint } };

/** Окно, которое соответствует текущему состоянию. */
export function logWindowOf(state: LogScanState): {
  fromBlock: bigint;
  toBlock: bigint;
} {
  const lower = state.cursor - state.span + 1n;
  return {
    fromBlock: lower < state.floor ? state.floor : lower,
    toBlock: state.cursor,
  };
}

/**
 * Жалобы узлов на слишком широкий диапазон.
 *
 * Регулярки живут рядом с тестами на настоящие тексты ответов, а не в файле
 * с сетью: подобрать окно по ответу узла — требование ТЗ, и проверяться оно
 * должно на строках, которые узлы действительно присылают.
 */
const TOO_MANY_RE =
  /more than \d+\s*results|response size exceeded|blocks? range|limit exceeded|too many blocks|range (is )?too (large|wide|big)/i;
/**
 * `deadline exceeded` — то же самое, что таймаут: так о нём сообщают узлы
 * на Go (Erigon, Nethermind за прокси). Ответ на него тот же — сузить окно,
 * а не объявлять незнакомую ошибку и прекращать скан.
 */
const TIMEOUT_RE = /timed?\s?out|timeout|deadline exceeded/i;
/** Подсказка Alchemy: «this block range should work: [0x…, 0x…]». */
const RANGE_HINT_RE = /\[\s*(0x[0-9a-fA-F]+)\s*,\s*(0x[0-9a-fA-F]+)\s*\]/;

/** Что за отказ прислал узел; null — незнакомая ошибка, гадать не будем. */
export function classifyNodeError(
  message: string,
): "tooMany" | "timeout" | null {
  if (TOO_MANY_RE.test(message)) return "tooMany";
  if (TIMEOUT_RE.test(message)) return "timeout";
  return null;
}

/**
 * Размер окна, который узел назвал сам. Применяется дословно: он знает
 * про свою нагрузку больше, чем наше деление пополам.
 */
export function logRangeHint(message: string): bigint | null {
  const m = RANGE_HINT_RE.exec(message);
  if (!m) return null;
  const lo = BigInt(m[1]);
  const hi = BigInt(m[2]);
  if (hi < lo) return null;
  return hi - lo + 1n;
}

/**
 * Редьюсер скана: всё поведение поиска в одной чистой функции.
 *
 * Идём НАЗАД от головы, потому что нужны ПОСЛЕДНИЕ операции: оборвавшись
 * на середине, мы отдадим самые свежие строки, а не самые старые.
 *
 * На «ok» курсор сдвигается и окно удваивается — сеть терпит, ускоряемся.
 * На отказ курсор НЕ двигается (этот кусок истории ещё не прочитан), окно
 * сужается. Съёжилось ниже MIN_LOG_SPAN — провайдер этого не умеет, и это
 * отдельный ответ, а не «операций нет».
 */
export function nextLogWindow(
  state: LogScanState,
  outcome: LogScanOutcome,
): LogScanStep {
  const requests = state.requests + 1;

  if (outcome.kind === "ok") {
    const scanned = logWindowOf(state);
    const cursor = scanned.fromBlock - 1n;
    if (cursor < state.floor) {
      return { done: "reached", reachedBlock: state.floor };
    }
    const doubled = state.span * 2n;
    const span = doubled > MAX_LOG_SPAN ? MAX_LOG_SPAN : doubled;
    return finish({ ...state, cursor, span, requests }, outcome);
  }

  const hint = outcome.message ? logRangeHint(outcome.message) : null;
  const span = hint ?? state.span / 2n;
  if (span < MIN_LOG_SPAN) {
    return { done: "unsupported", reachedBlock: state.cursor + 1n };
  }
  return finish({ ...state, span, requests }, outcome);
}

function finish(state: LogScanState, outcome: LogScanOutcome): LogScanStep {
  if (outcome.nowMs >= state.deadlineMs) {
    return { done: "deadline", reachedBlock: state.cursor + 1n };
  }
  if (state.requests >= MAX_LOG_REQUESTS) {
    return { done: "budget", reachedBlock: state.cursor + 1n };
  }
  return { state, range: logWindowOf(state) };
}

// --- Сборка строк ---

/** Трансфер, как его отдал любой из двух путей, до классификации. */
export interface GmTransferRaw {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  from: string;
  to: string;
  /**
   * Количество GM в сыром виде, 18 знаков. Именно bigint: у Alchemy рядом
   * лежит готовое `value` типа float, и брать его нельзя — это число уходит
   * прямо в `gm_level_actions.gm_amount`, который not null ровно потому,
   * что больше нигде не существует.
   */
  raw: bigint;
  /** Время блока, если источник его дал (Alchemy `withMetadata`). */
  timestampSec?: bigint;
}

export interface GmTransferItem {
  key: string;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  kind: GmTransferKind;
  /** Десятичная строка, 18 знаков — не float. */
  gmAmount: string;
  happenedAtSec: bigint | null;
  timeApproximate: boolean;
}

/** GM-токены всегда 18 знаков (см. gmx.ts). */
const GM_DECIMALS = 18;

/**
 * Классификация, дедупликация, сортировка и обрезка — одним проходом.
 *
 * Два пути (Alchemy отдельно «пришло» и «ушло», getLogs — одним фильтром)
 * дают пересекающиеся списки, поэтому ключ `${txHash}:${logIndex}` обязателен.
 * Burn и mint В ОДНОЙ транзакции — не edge-случай, а базовый сценарий §5
 * (продали на уровне и тут же откупили), поэтому дедуплицируем по логу,
 * а не по транзакции.
 */
export function assembleRows(
  raws: readonly GmTransferRaw[],
  wallet: string,
): GmTransferItem[] {
  const byKey = new Map<string, GmTransferItem>();

  for (const r of raws) {
    const kind = classifyTransfer({ from: r.from, to: r.to, wallet });
    if (kind === null) continue;

    const txHash = r.txHash.toLowerCase();
    const key = `${txHash}:${r.logIndex}`;
    if (byKey.has(key)) continue;

    byKey.set(key, {
      key,
      txHash,
      logIndex: r.logIndex,
      blockNumber: r.blockNumber,
      kind,
      gmAmount: formatUnits(r.raw, GM_DECIMALS),
      happenedAtSec: r.timestampSec ?? null,
      timeApproximate: false,
    });
  }

  const rows = [...byKey.values()].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber > b.blockNumber ? -1 : 1;
    }
    return b.logIndex - a.logIndex;
  });

  return rows.slice(0, GM_ROW_LIMIT);
}

// --- Цены ---

/** Сутки — граница, за которой CoinGecko переходит на часовую сетку. */
const DAY_SEC = 86_400n;
/**
 * Паддинг вокруг набора строк, когда весь набор укладывается в сутки.
 * 300 секунд = один шаг пятиминутной сетки CoinGecko.
 */
const TIGHT_PAD_SEC = 300n;
/** Паддинг, когда размах и так больше суток: гранулярность уже часовая. */
const WIDE_PAD_SEC = 3_600n;
/**
 * Граница «однодневного» набора: сутки минус двойной узкий паддинг.
 *
 * CoinGecko отдаёт пятиминутные точки только на диапазонах до суток
 * включительно. Прибавить час к набору длиной в 23 часа — значит перевалить
 * за сутки и молча получить часовую сетку в самом частом случае: перенос
 * точки отсчёта в день операции.
 *
 * Величина считается, а не пишется числом: раньше здесь стояло 82 800 —
 * «сутки минус ЧАС», хотя вычитать надо было паддинг. Наборы размахом
 * от 23 до 23:50 часов получали часовую сетку там, где узкий паддинг
 * оставлял запрос в пределах суток.
 */
const TIGHT_SPREAD_MAX_SEC = DAY_SEC - 2n * TIGHT_PAD_SEC;

/**
 * Диапазон запроса цен по найденным строкам; null — времени ни у одной нет.
 *
 * Инвариант: размах ≤ TIGHT_SPREAD_MAX_SEC ⟹ запрошенный диапазон ≤ суток,
 * то есть пятиминутная сетка. Он и проверяется тестом с обеих сторон границы.
 */
export function priceRangeFor(
  rows: readonly { happenedAtSec: bigint | null }[],
): { fromSec: bigint; toSec: bigint } | null {
  const times = rows
    .map((r) => r.happenedAtSec)
    .filter((t): t is bigint => t !== null);
  if (times.length === 0) return null;

  let min = times[0];
  let max = times[0];
  for (const t of times) {
    if (t < min) min = t;
    if (t > max) max = t;
  }

  const pad = max - min <= TIGHT_SPREAD_MAX_SEC ? TIGHT_PAD_SEC : WIDE_PAD_SEC;
  return { fromSec: min - pad, toSec: max + pad };
}

/** Насколько далёкую точку ещё принимаем за цену момента. */
const PRICE_TOLERANCE_FLOOR_SEC = 7_200;

export interface PricePoint {
  priceUsd: number;
  atMs: number;
}

/**
 * Ближайшая по времени точка ряда; null — ряд пуст или момент вне покрытия.
 *
 * Допуск не декоративный: диапазон запрашивается с паддингом, поэтому
 * промах больше двух шагов означает, что CoinGecko не отдал этот участок.
 * Подставить в таком случае «ближайшую» цену недельной давности — ровно то
 * молчаливое враньё, которое ТЗ запрещает (§S8.5, «погрешность называется»).
 */
export function pickPriceAt(
  series: PriceSeries,
  tsSec: bigint,
): PricePoint | null {
  if (series.points.length === 0) return null;

  const targetMs = Number(tsSec) * 1000;
  let best = series.points[0];
  let bestGap = Math.abs(best[0] - targetMs);
  for (const p of series.points) {
    const gap = Math.abs(p[0] - targetMs);
    if (gap < bestGap) {
      best = p;
      bestGap = gap;
    }
  }

  const tolerance = Math.max(
    (series.stepSec ?? 3_600) * 2,
    PRICE_TOLERANCE_FLOOR_SEC,
  );
  if (bestGap > tolerance * 1000) return null;

  return { priceUsd: best[1], atMs: best[0] };
}
