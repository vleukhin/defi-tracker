import "server-only";
import {
  blockAtTimestamp,
  blockTimestamps,
  timestampFromSamples,
  type BlockRpcClient,
  type BlockWindow,
} from "./blocks";
import {
  GM_SEARCH_DAYS,
  assembleRows,
  assetTransfersParams,
  classifyNodeError,
  initialLogSpan,
  logWindowOf,
  logsFilter,
  nextLogWindow,
  pickPriceAt,
  priceRangeFor,
  searchWindowSec,
  type GmTransferItem,
  type GmTransferRaw,
  type LogScanDone,
  type LogScanOutcome,
  type LogScanState,
  type TransferSide,
} from "./gm-transfers";
import { coingeckoIdForSymbol } from "@/lib/prices/symbol-coingecko";
import type { PriceSeries } from "@/lib/prices/coingecko";
import type { logApiCall } from "@/lib/metrics";
import type {
  GmTransferReason,
  GmTransferRowDto,
  GmTransferSource,
  GmTransfersResponseDto,
} from "@/lib/api/types";

/**
 * Поиск фактических операций с GM-токеном по блокчейну (Фаза 8, S8.5).
 *
 * Оркестратор: сеть, провайдеры, бюджеты. Вся содержательная логика —
 * в gm-transfers.ts, здесь только склейка.
 *
 * НИКОГДА НЕ БРОСАЕТ. Это требование, а не осторожность: исключение отсюда
 * всплыло бы наружу пятисоткой, и владелец прочитал бы «сломалось» там, где
 * правда — «провайдер не умеет отвечать на такой диапазон». Разница между
 * этими двумя ответами и есть половина смысла S8.5.
 */

/** Узкий интерфейс клиента: заголовки блоков плюс сырой eth_getLogs. */
export interface GmSearchRpcClient extends BlockRpcClient {
  request(args: { method: "eth_getLogs"; params: [unknown] }): Promise<unknown>;
}

export interface GmSearchDeps {
  client: GmSearchRpcClient;
  fetchFn: typeof fetch;
  /** URL Alchemy; null — ключа нет, идём сразу запасным путём. */
  alchemyUrl: string | null;
  logCall: typeof logApiCall;
  nowMs: () => number;
  /** Абсолютный момент, после которого скан обязан вернуть partial. */
  deadlineMs: number;
  cg: {
    fetchRange(
      id: string,
      fromSec: number,
      toSec: number,
    ): Promise<PriceSeries>;
  };
}

export interface GmSearchArgs {
  /** Адрес GM-токена рынка — он же external_id позиции. */
  gmToken: string;
  /** Кошелёк ИМЕННО этой позиции. */
  wallet: string;
  /** Символ базового (long) актива пула. */
  longSymbol: string | null;
  /** coingeckoId из payload позиции; null — попробуем вывести из символа. */
  coingeckoId: string | null;
}

const asIso = (sec: bigint) => new Date(Number(sec) * 1000).toISOString();

/**
 * Бюджет `deps.deadlineMs` — один на весь поиск, а не на скан логов.
 *
 * Раньше срок держал только цикл eth_getLogs, и это давало две дыры. Первая:
 * запрос к Alchemy шёл без AbortSignal, поэтому зависший провайдер держал
 * обработчик столько, сколько хотел. Вторая: цены запрашивались ПОСЛЕ того,
 * как скан выбрал весь бюджет, а fetchMarketChartRange при 429 спит пятнадцать
 * секунд и повторяет запрос — суммарно обработчик выходил далеко за отпущенные
 * ему секунды, Vercel обрывал соединение, и владелец видел сетевую ошибку
 * вместо честного `partial`. Ответ «строки есть, цены нет» несравнимо лучше:
 * количество GM по S8.1 обязательно, цена — нет.
 */

/**
 * Какую долю ОСТАТКА бюджета можно отдать первичному пути.
 *
 * Не весь остаток: Alchemy может отвечать медленно и всё равно ответить
 * отказом, после которого нужен запасной путь. Половина — компромисс между
 * «дождаться» и «успеть спросить узел».
 */
const ALCHEMY_BUDGET_SHARE = 0.5;
/** Меньше секунды спрашивать Alchemy бессмысленно — идём сразу к eth_getLogs. */
const ALCHEMY_MIN_BUDGET_MS = 1_000;
/**
 * Ниже этого остатка цены даже не запрашиваются.
 *
 * CoinGecko отвечает за сотни миллисекунд, но у клиента есть token-bucket
 * и повтор при 429; двух секунд хватает на обычный ответ и не хватает на
 * то, чтобы уйти за срок незаметно.
 */
const PRICE_MIN_BUDGET_MS = 2_000;

/**
 * Ждать `work` не дольше `ms`; не дождались или упали — отдаём `fallback()`.
 *
 * Именно ждать, а не отменять: `deps.cg.fetchRange` — чужой интерфейс без
 * AbortSignal, и заставить CoinGecko замолчать отсюда нельзя. Зато можно
 * перестать ждать ответа, который уже опоздал.
 */
function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  fallback: (reason: string) => T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback(`бюджет ${ms} мс исчерпан`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        resolve(fallback(errorText(err)));
      },
    );
  });
}

/** Текст ошибки целиком: у viem причина лежит в details/shortMessage. */
function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const extra = err as { details?: unknown; shortMessage?: unknown };
  return [err.message, extra.shortMessage, extra.details]
    .filter((v): v is string => typeof v === "string")
    .join(" | ");
}

// --- Первичный путь: alchemy_getAssetTransfers ---

interface AlchemyTransfer {
  hash?: unknown;
  uniqueId?: unknown;
  blockNum?: unknown;
  from?: unknown;
  to?: unknown;
  rawContract?: { value?: unknown };
  metadata?: { blockTimestamp?: unknown };
}

/** Alchemy отдаёт логовый индекс внутри uniqueId вида `0x…:log:12`. */
function logIndexOf(uniqueId: unknown, side: TransferSide): number {
  if (typeof uniqueId === "string") {
    const m = /:log:(\d+)$/.exec(uniqueId);
    if (m) return Number(m[1]);
  }
  // uniqueId не разобрался: индекс всё равно должен различать mint и burn
  // одной транзакции (базовый случай §5), иначе дедупликация склеит их в одну
  // строку и продажа с откупом на уровне превратится в одну операцию.
  return side === "in" ? -1 : -2;
}

function parseAlchemyTransfers(
  result: unknown,
  side: TransferSide,
): GmTransferRaw[] {
  const body = result as { transfers?: unknown; pageKey?: unknown };
  // pageKey читается и ОСОЗНАННО игнорируется: страница вмещает сотню
  // трансферов, показываем десять последних, и order:"desc" гарантирует, что
  // они на первой странице. Гоняться за второй значило бы тратить бюджет
  // времени на строки, которые на экран не попадут.
  void body.pageKey;

  if (!Array.isArray(body.transfers)) return [];

  const out: GmTransferRaw[] = [];
  for (const t of body.transfers as AlchemyTransfer[]) {
    const hash = t.hash;
    const value = t.rawContract?.value;
    if (typeof hash !== "string") continue;
    // Количество GM берём ТОЛЬКО из rawContract.value: соседнее поле value
    // у Alchemy — float, а это число уходит в gm_level_actions.gm_amount
    if (typeof value !== "string") continue;
    if (typeof t.blockNum !== "string") continue;
    if (typeof t.from !== "string" || typeof t.to !== "string") continue;

    const stamp = t.metadata?.blockTimestamp;
    const ms = typeof stamp === "string" ? Date.parse(stamp) : NaN;

    out.push({
      txHash: hash,
      logIndex: logIndexOf(t.uniqueId, side),
      blockNumber: BigInt(t.blockNum),
      from: t.from,
      to: t.to,
      raw: BigInt(value),
      // withMetadata даёт время блока сразу, поэтому на этом пути переводить
      // блоки во время не нужно вообще
      ...(Number.isNaN(ms) ? {} : { timestampSec: BigInt(Math.floor(ms / 1000)) }),
    });
  }
  return out;
}

async function viaAlchemy(
  args: GmSearchArgs,
  deps: GmSearchDeps,
  window: BlockWindow,
): Promise<GmTransferRaw[] | null> {
  if (!deps.alchemyUrl) return null;

  // Время могло выйти ещё до первичного пути. Тратить остаток на запрос,
  // ответ которого мы всё равно не дождёмся, — значит отнять его у запасного
  // пути и у цен
  const remainingMs = deps.deadlineMs - deps.nowMs();
  if (remainingMs <= ALCHEMY_MIN_BUDGET_MS) {
    console.warn(
      `[gm-search] alchemy_getAssetTransfers пропущен: осталось ${remainingMs} мс`,
    );
    return null;
  }
  const budgetMs = Math.max(
    ALCHEMY_MIN_BUDGET_MS,
    Math.floor(remainingMs * ALCHEMY_BUDGET_SHARE),
  );

  const query = {
    gmToken: args.gmToken,
    wallet: args.wallet,
    fromBlock: window.from.block,
    toBlock: window.latest.block,
  };

  // Один контроллер на обе стороны: обрыв по сроку касается запроса целиком,
  // а половина ответа нам не нужна — классификация идёт по обеим сторонам
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`бюджет ${budgetMs} мс исчерпан`)),
    budgetMs,
  );

  const ask = async (side: TransferSide): Promise<GmTransferRaw[]> => {
    const res = await deps.fetchFn(deps.alchemyUrl as string, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: side === "in" ? 1 : 2,
        method: "alchemy_getAssetTransfers",
        params: [assetTransfersParams(query, side)],
      }),
    });
    if (!res.ok) throw new Error(`alchemy_getAssetTransfers: HTTP ${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: unknown };
    if (json.error) {
      const e = json.error as { message?: unknown };
      throw new Error(
        typeof e.message === "string" ? e.message : "alchemy: неизвестная ошибка",
      );
    }
    return parseAlchemyTransfers(json.result, side);
  };

  try {
    // Две стороны кошелька: mint приходит ему, burn уходит от него.
    // Нулевой адрес в фильтр не кладём — классификация чистая и общая.
    const [incoming, outgoing] = await Promise.all([ask("in"), ask("out")]);
    void deps.logCall("alchemy", "gm:assetTransfers", { units: 2 });
    return [...incoming, ...outgoing];
  } catch (err) {
    // Ключа нет, Alchemy отказала или не уложилась в срок — падаем на запасной
    // путь, а не роняем фичу: eth_getLogs умеет любой узел из fallback-цепочки.
    // Обрыв по AbortSignal приходит сюда же обычным исключением
    void deps.logCall("alchemy", "gm:assetTransfers", { units: 2, ok: false });
    console.warn(`[gm-search] alchemy_getAssetTransfers: ${errorText(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- Запасной путь: eth_getLogs окнами ---

interface RawLog {
  transactionHash?: unknown;
  logIndex?: unknown;
  blockNumber?: unknown;
  topics?: unknown;
  data?: unknown;
}

/** Адрес из topic: 32 байта, значимы последние 20. */
function addressFromTopic(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function parseLogs(result: unknown): GmTransferRaw[] {
  if (!Array.isArray(result)) return [];
  const out: GmTransferRaw[] = [];
  for (const log of result as RawLog[]) {
    const topics = log.topics;
    if (!Array.isArray(topics) || topics.length < 3) continue;
    if (typeof log.transactionHash !== "string") continue;
    if (typeof log.blockNumber !== "string") continue;
    if (typeof log.logIndex !== "string") continue;
    if (typeof topics[1] !== "string" || typeof topics[2] !== "string") continue;
    if (typeof log.data !== "string" || log.data === "0x") continue;

    out.push({
      txHash: log.transactionHash,
      logIndex: Number(BigInt(log.logIndex)),
      blockNumber: BigInt(log.blockNumber),
      from: addressFromTopic(topics[1]),
      to: addressFromTopic(topics[2]),
      raw: BigInt(log.data),
    });
  }
  return out;
}

interface LogScanResult {
  raws: GmTransferRaw[];
  done: LogScanDone | null;
  /** Незнакомая ошибка узла — гадать по ней нельзя, скан прекращён. */
  fatal: string | null;
  /** Самый старый блок, который РЕАЛЬНО просмотрен. */
  reachedBlock: bigint;
  /** Сколько окон прочитано успешно. */
  okRequests: number;
}

async function viaLogs(
  args: GmSearchArgs,
  deps: GmSearchDeps,
  window: BlockWindow,
): Promise<LogScanResult> {
  let state: LogScanState = {
    cursor: window.latest.block,
    floor: window.from.block,
    span: initialLogSpan(window),
    requests: 0,
    deadlineMs: deps.deadlineMs,
  };
  let range = logWindowOf(state);
  const raws: GmTransferRaw[] = [];
  let okRequests = 0;

  // Время могло кончиться ещё до первого запроса — на первичный путь его
  // тоже тратили
  if (deps.nowMs() >= deps.deadlineMs) {
    return {
      raws,
      done: "deadline",
      fatal: null,
      reachedBlock: state.cursor + 1n,
      okRequests,
    };
  }

  for (;;) {
    let outcome: LogScanOutcome;
    try {
      const result = await deps.client.request({
        method: "eth_getLogs",
        params: [
          logsFilter({
            gmToken: args.gmToken,
            wallet: args.wallet,
            fromBlock: range.fromBlock,
            toBlock: range.toBlock,
          }),
        ],
      });
      raws.push(...parseLogs(result));
      okRequests += 1;
      outcome = { kind: "ok", nowMs: deps.nowMs() };
    } catch (err) {
      const message = errorText(err);
      const kind = classifyNodeError(message);
      if (kind === null) {
        // Узел пожаловался на что-то своё. Сужать окно наугад бессмысленно:
        // причина может быть любой, а бюджет один
        console.warn(`[gm-search] eth_getLogs: ${message}`);
        return {
          raws,
          done: null,
          fatal: message,
          reachedBlock: state.cursor + 1n,
          okRequests,
        };
      }
      outcome = { kind, message, nowMs: deps.nowMs() };
    }

    const step = nextLogWindow(state, outcome);
    if ("done" in step) {
      void deps.logCall("rpc", "gm:getLogs", {
        units: state.requests + 1,
        ok: step.done === "reached",
      });
      return {
        raws,
        done: step.done,
        fatal: null,
        reachedBlock: step.reachedBlock,
        okRequests,
      };
    }
    state = step.state;
    range = step.range;
  }
}

// --- Цены ---

/**
 * Строка без цены.
 *
 * Не заглушка на случай ошибки, а полноценный ответ: количество GM известно
 * точно и без CoinGecko, а по S8.1 обязательно именно оно. Цены нет —
 * `assetPriceUsd: null`, и экран говорит «цены нет» вместо выдуманного числа.
 */
function plainRow(r: GmTransferItem): GmTransferRowDto {
  return {
    key: r.key,
    txHash: r.txHash,
    blockNumber: Number(r.blockNumber),
    kind: r.kind,
    gmAmount: r.gmAmount,
    happenedAt: r.happenedAtSec === null ? null : asIso(r.happenedAtSec),
    timeApproximate: r.timeApproximate,
    assetPriceUsd: null,
    priceAtIso: null,
    priceStepSec: null,
  };
}

async function priceRows(
  rows: GmTransferItem[],
  coingeckoId: string | null,
  deps: GmSearchDeps,
): Promise<GmTransferRowDto[]> {
  const plain = plainRow;

  const range = priceRangeFor(rows);
  // coingeckoId === null — НЕ отказ: количество GM известно и без цены,
  // а форма переноса точки за ним и приходит.
  // range === null — времени нет ни у одной строки, спрашивать нечего
  if (coingeckoId === null || range === null) return rows.map(plain);

  let series: PriceSeries;
  try {
    series = await deps.cg.fetchRange(
      coingeckoId,
      Number(range.fromSec),
      Number(range.toSec),
    );
  } catch (err) {
    console.warn(`[gm-search] цены CoinGecko не получены: ${errorText(err)}`);
    return rows.map(plain);
  }

  return rows.map((r) => {
    const base = plain(r);
    if (r.happenedAtSec === null) return base;
    const point = pickPriceAt(series, r.happenedAtSec);
    if (point === null) return base;
    return {
      ...base,
      assetPriceUsd: point.priceUsd,
      priceAtIso: new Date(point.atMs).toISOString(),
      priceStepSec: series.stepSec,
    };
  });
}

/**
 * Цены в пределах общего бюджета.
 *
 * Цена — единственный необязательный кусок ответа, и платить за него срывом
 * всего запроса нельзя. Осталось мало времени — строки уходят без цены;
 * ответ не дождался — тоже. В DTO у строки нет поля «почему цены нет»,
 * и выдумывать его здесь незачем: «id актива не нашли» видно по
 * `assetCoingeckoId: null` в ответе целиком, а `assetCoingeckoId` заполнен
 * при пустой `assetPriceUsd` и означает «цену спросить не успели».
 */
async function pricedRows(
  rows: GmTransferItem[],
  coingeckoId: string | null,
  deps: GmSearchDeps,
): Promise<GmTransferRowDto[]> {
  const plain = () => rows.map(plainRow);
  if (rows.length === 0 || coingeckoId === null) return plain();

  const remainingMs = deps.deadlineMs - deps.nowMs();
  if (remainingMs <= PRICE_MIN_BUDGET_MS) {
    console.warn(
      `[gm-search] цены не запрашивались: осталось ${remainingMs} мс`,
    );
    return plain();
  }

  return withTimeout(priceRows(rows, coingeckoId, deps), remainingMs, (reason) => {
    console.warn(`[gm-search] цены не дождались: ${reason}`);
    return plain();
  });
}

// --- Оркестратор ---

export async function findGmTransfers(
  args: GmSearchArgs,
  deps: GmSearchDeps,
): Promise<GmTransfersResponseDto> {
  const assetSymbol = args.longSymbol;
  const assetCoingeckoId =
    args.coingeckoId ??
    (args.longSymbol ? coingeckoIdForSymbol(args.longSymbol) : null);

  const blank = (
    status: GmTransfersResponseDto["status"],
    reason: GmTransferReason,
  ): GmTransfersResponseDto => ({
    status,
    rows: [],
    assetSymbol,
    assetCoingeckoId,
    searchDays: GM_SEARCH_DAYS,
    window: null,
    source: "none",
    reason,
  });

  try {
    const nowSec = BigInt(Math.floor(deps.nowMs() / 1000));
    const wanted = searchWindowSec(nowSec);

    const window = await blockAtTimestamp(deps.client, wanted.fromSec);
    if (window === null) return blank("unavailable", "no_window");

    let source: GmTransferSource = "alchemy";
    let raws = await viaAlchemy(args, deps, window);
    let scan: LogScanResult | null = null;

    if (raws === null) {
      source = "logs";
      scan = await viaLogs(args, deps, window);
      raws = scan.raws;
    }

    const items = assembleRows(raws, args.wallet);

    // Время блоков — только на запасном пути и только ПОСЛЕ обрезки до
    // десяти строк: иначе удачный скан на тысячу трансферов превратился бы
    // в тысячу запросов заголовков
    if (scan !== null && items.length > 0) {
      const times = await blockTimestamps(
        deps.client,
        items.map((i) => i.blockNumber),
        window,
      );
      for (const item of items) {
        const t = times.get(item.blockNumber.toString());
        if (t) {
          item.happenedAtSec = t.sec;
          item.timeApproximate = !t.exact;
        }
      }
    }

    const rows = await pricedRows(items, assetCoingeckoId, deps);

    // Нижняя граница окна — та, до которой РЕАЛЬНО дошли. Назвать здесь
    // номинальные 14 суток значило бы сказать «за две недели ничего»,
    // не посмотрев за две недели.
    //
    // Это касается и оборвавшегося скана (done === null): он тоже сообщает
    // блок, до которого успел дойти, и подставлять вместо него нижнюю
    // границу — ровно та ложь, которую запрещает S8.5. Зажим сверху нужен
    // для случая, когда не прошло ни одного запроса: reachedBlock тогда
    // выше головы, и честный ответ — «просмотрено ноль блоков».
    const reachedBlock =
      scan === null
        ? window.from.block
        : scan.reachedBlock < window.from.block
          ? window.from.block
          : scan.reachedBlock > window.latest.block
            ? window.latest.block
            : scan.reachedBlock;
    const reachedSec =
      reachedBlock === window.from.block
        ? window.from.timestamp
        : reachedBlock === window.latest.block
          ? window.latest.timestamp
          : // Не сошлась интерполяция — объявляем меньшее покрытие, а не
            // большее: ошибиться в сторону «посмотрели меньше» безопасно
            (timestampFromSamples(window.latest, window.from, reachedBlock) ??
            window.latest.timestamp);

    const windowDto = {
      fromIso: asIso(reachedSec),
      toIso: asIso(window.latest.timestamp),
      fromBlock: Number(reachedBlock),
      toBlock: Number(window.latest.block),
    };

    let status: GmTransfersResponseDto["status"];
    let reason: GmTransferReason | null = null;

    if (scan === null || scan.done === "reached") {
      status = rows.length > 0 ? "found" : "empty";
    } else if (scan.done === "unsupported") {
      status = "unsupported";
      reason = "range_unsupported";
    } else if (scan.done === "deadline") {
      status = "partial";
      reason = "deadline";
    } else if (scan.done === "budget") {
      status = "partial";
      reason = "request_budget";
    } else {
      // fatal: узел ответил незнакомой ошибкой. Что-то успели прочитать —
      // отдаём как частичный ответ, ничего не успели — «спросить не смогли»
      status = scan.okRequests > 0 ? "partial" : "unavailable";
      reason = "provider_error";
    }

    return {
      status,
      rows,
      assetSymbol,
      assetCoingeckoId,
      searchDays: GM_SEARCH_DAYS,
      window: windowDto,
      source: rows.length === 0 && status === "unavailable" ? "none" : source,
      reason,
    };
  } catch (err) {
    console.warn(`[gm-search] поиск не выполнен: ${errorText(err)}`);
    return blank(
      "unavailable",
      deps.alchemyUrl ? "provider_error" : "no_provider",
    );
  }
}
