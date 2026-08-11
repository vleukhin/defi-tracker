import type {
  DebtChainDto,
  DebtResponseDto,
  PortfolioDto,
  PositionDto,
  ZonesSummaryDto,
} from "@/lib/api/types";
import { STALE_AFTER_MS } from "@/lib/alerts/hf";
import { countLabel } from "@/components/portfolio/plural";
import { DEBT_UNREAD_HINT, formatHf, formatHfThreshold } from "@/components/debt/hf";
import { liquidationDrop, ltvRebalance } from "@/components/debt/risk";
import {
  HF_URGENT,
  HF_ZONE_LABEL,
  HF_ZONE_RANK,
  type HfZone,
  hfZone,
  isDangerZone,
} from "@/lib/hf-zones";
import { chainLabel, dcPp, dcRate, dcUsd, tablePct } from "@/lib/format";
import { gmLevels } from "@/lib/positions/gm-levels";
import { GM_SHARE_TOLERANCE_PP, gmShare } from "@/lib/positions/gm-split";
import { exitSide } from "@/lib/positions/lp-range";
import { RANGE_WAIT_HOURS, rangeDecision } from "@/lib/positions/range-timer";
import { positionSpread } from "@/lib/positions/rates";

/**
 * Лента «Что делать сейчас» — единый список того, что требует действия
 * (docs/07 §5–§7).
 *
 * Своей арифметики здесь нет ни строки: все величины уже считают hf-zones,
 * gm-levels, gm-split, range-timer, rates и risk. Модуль отвечает только
 * на три вопроса — что показать, в каком порядке и какими словами.
 *
 * ПОРЯДОК ЗАДАН СТРАТЕГИЕЙ, а не важностью «на глаз». Первой всегда идёт
 * ликвидация: заём погашать не планируется, плечо постоянное, и это
 * единственный сценарий, способный принудительно прервать накопление
 * (docs/03 §S4.3). Остальные риски переживаемы.
 *
 * МОЛЧАНИЕ ЗАПРЕЩЕНО. Непрочитанные данные — это не спокойствие: «долг ни
 * разу не читался» стоит на месте риска ликвидации, а не в гигиене, а пока
 * источник грузится, лента говорит об этом словами (`hasPendingSources`),
 * а не показывает пустой список.
 *
 * «Сейчас» приходит снаружи, как в rangeDecision и evaluateHfAlert: с
 * Date.now() внутри правило 48 часов и порог слепоты были бы непроверяемы.
 *
 * ДОЛГ: `components/debt/risk.ts` и `components/debt/hf.ts` — чистые модули
 * без React, но живут в components/. Импорт lib → components здесь допущен
 * сознательно; их переезд в lib/risk делается вместе со следующей правкой
 * экрана «Долг», а не ради ленты.
 */

/** Уровень серьёзности; определяет порядок в ленте. */
export type SignalSeverity =
  /** Риск ликвидации и слепота по нему. */
  | "liquidation"
  /** Уровень падения или роста GM пройден (§5, §6). */
  | "level"
  /** Правило 48 часов по CLMM (§7). */
  | "timer"
  /** Плечо и ставки — правятся при следующей операции. */
  | "leverage"
  /** Данные не сходятся; числа выше под вопросом. */
  | "hygiene";

/**
 * Тон строки. Свой тип, а не StatusTone из dc/chip: модуль не знает
 * о компонентах, а «нейтрального» тона у чипа статуса нет вовсе.
 */
export type SignalTone = "loss" | "warn" | "neutral";

/** Куда ведёт строка; ссылку или переключатель разрешает компонент. */
export type SignalTarget = "debt" | "zones" | "wallets" | null;

export type SignalKind =
  | "hf-below"
  | "hf-stale"
  | "hf-unread"
  | "debt-unread"
  | "debt-unavailable"
  | "gm-level"
  | "gm-growth"
  | "clmm-ready"
  | "clmm-waiting"
  | "clmm-unknown-since"
  | "ltv-off-target"
  | "rate-below-borrow"
  | "gm-split"
  | "zones-unavailable"
  | "zones-mismatch"
  | "positions-unmarked"
  | "positions-unpriced"
  | "free-unmarked"
  | "gm-no-entry"
  | "gm-no-price"
  | "borrow-rate-unread"
  | "chains-unread"
  | "prices-stale"
  | "refresh-failed";

export interface Signal {
  /** Ключ строки: React key и якорь тестов. */
  key: string;
  kind: SignalKind;
  severity: SignalSeverity;
  /** Величина внутри уровня: больше — выше в ленте. */
  weight: number;
  tone: SignalTone;
  /** Короткая метка: «HF 1,28», «−15%», «ждать 23 ч». null — без чипа. */
  chip: string | null;
  /** Утверждение с числом, без точки в конце. */
  title: string;
  /** Что предусмотрено стратегией. Одно предложение; null — нечего добавить. */
  detail: string | null;
  /** Методика и оговорки — уходит под «?», в поток не попадает. */
  hint: string | null;
  target: SignalTarget;
  /**
   * Натуральный ключ отметки «выполнено»; null = сигнал не отмечается.
   * Отмечают только то, где стратегия предписывает разовую операцию:
   * риск ликвидации — состояние, а не задача, а гигиена гаснет сама,
   * когда данные починены.
   */
  ackKey: string | null;
  /**
   * Обстановка, к которой относится отметка. Сменилась — сигнал вернулся:
   * у GM это точка отсчёта (подвижна, §7), у CLMM — момент выхода из
   * диапазона. Новый уровень отдельного правила не требует: у него
   * другой ackKey.
   */
  ackFingerprint: string | null;
  /** Владелец сказал «сделал», и обстановка с тех пор не менялась. */
  acked: boolean;
}

/** Строка signal_acks, сведённая к тому, что нужно ленте. */
export interface SignalAck {
  signalKey: string;
  fingerprint: string;
}

export interface SignalsInput {
  portfolio: PortfolioDto | null;
  debt: DebtResponseDto | null;
  /** null ≠ [] — «не прочитано» и «позиций нет» это разные ответы. */
  positions: PositionDto[] | null;
  zones: ZonesSummaryDto | null;
  /** «Активы» того же чтения, что и сумма зон — для сверки инварианта. */
  assetsUsd: number | null;
  /** Средневзвешенная ставка заёмных стейблов; null = не прочитана. */
  stableBorrowRatePercent: number | null;
  /** Цель плеча, % — приезжает вместе с долгом (docs/07 §8). */
  targetLtvPct: number;
  /** Отметки «выполнено»; null = ещё не прочитаны. */
  acks: SignalAck[] | null;
  /** Уровни, где есть хотя бы одна запись текущего цикла, по zoneKey. */
  actedGmLevels?: ReadonlyMap<string, ReadonlySet<number>>;
  /** Источники в пути: молчание при загрузке — не «всё спокойно». */
  pending: {
    portfolio: boolean;
    debt: boolean;
    zones: boolean;
    acks: boolean;
    /**
     * Журнал уровней ещё читается. Пока он не пришёл, отработанные уровни
     * неизвестны и подавить сигнал нечем — лента показала бы уровень,
     * по которому владелец уже действовал, и тут же его убрала.
     */
    journals: boolean;
  };
  /** Состояние экрана: этого нет ни в одном DTO. */
  runtime: {
    debtError: string | null;
    zonesError: string | null;
    refreshError: string | null;
    /** Сети, не прочитавшиеся при последнем POST /api/refresh. */
    chainIssues: { chain: string; message: string }[];
  };
}

const SEVERITY_RANK: Record<SignalSeverity, number> = {
  liquidation: 0,
  level: 1,
  timer: 2,
  leverage: 3,
  hygiene: 4,
};

/**
 * Отклонение LTV от цели, с которого плечо считается сбитым, п.п.
 *
 * Не новое число: столько же в DEVIATION_THRESHOLD_PP и
 * GM_SHARE_TOLERANCE_PP — единица значимости отклонения в приложении одна.
 * На цели 50% это коридор 45…55%, и дрожание цен между чтениями в него
 * не попадает.
 */
export const LTV_TOLERANCE_PP = 5;

/** Допуск сверки зон с активами — тот же, что у полосы сверки на «Зонах». */
const ZONES_MISMATCH_USD = 0.5;

/** Сколько сигналов показывается до свёртки — знает и лента, и карточка. */
export const SIGNALS_VISIBLE = 5;

const HOUR_MS = 3_600_000;

/**
 * Сигнал до применения отметок. Поля отметки необязательны: их задают
 * только те сборщики, чьи сигналы вообще отмечаются, а `acked` знает
 * один buildSignals — сверять отпечатки в каждой группе значило бы
 * написать одно правило четыре раза.
 */
type SignalDraft = Omit<Signal, "ackKey" | "ackFingerprint" | "acked"> & {
  ackKey?: string;
  ackFingerprint?: string;
};

export function buildSignals(input: SignalsInput, nowMs: number): Signal[] {
  const drafts: SignalDraft[] = [
    ...riskSignals(input, nowMs),
    ...positionSignals(input, nowMs),
    ...leverageSignals(input),
    ...hygieneSignals(input),
  ];

  const ackByKey = new Map(
    (input.acks ?? []).map((a) => [a.signalKey, a.fingerprint]),
  );

  const signals: Signal[] = drafts.map((draft) => ({
    ...draft,
    ackKey: draft.ackKey ?? null,
    ackFingerprint: draft.ackFingerprint ?? null,
    // Отметка действует, только пока обстановка та же: сменилась точка
    // отсчёта или момент выхода из диапазона — решение новое
    acked:
      draft.ackKey !== undefined &&
      draft.ackFingerprint !== undefined &&
      ackByKey.get(draft.ackKey) === draft.ackFingerprint,
  }));

  // Единственное подавление в ленте: при HF в опасной зоне отклонение LTV
  // говорит о том же плече вторым голосом и слабее. Остальные конфликты
  // гасятся сами — gmLevels без точки отсчёта, positionSpread без ставки
  // и ltvRebalance без залога возвращают null.
  const dangerHf = signals.some((s) => s.kind === "hf-below");
  const visible = dangerHf
    ? signals.filter((s) => s.kind !== "ltv-off-target")
    : signals;

  // Ключ третьим ключом сортировки: без него порядок двух GM-пулов
  // с одинаковым уровнем зависел бы от порядка массива позиций.
  return visible.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.weight - a.weight ||
      a.key.localeCompare(b.key),
  );
}

/** Часть источников ещё читается — «действий нет» показывать нельзя. */
export function hasPendingSources(input: SignalsInput): boolean {
  return (
    input.pending.portfolio ||
    input.pending.debt ||
    input.pending.zones ||
    input.pending.acks ||
    input.pending.journals
  );
}

/** Строки, требующие внимания: отмеченные выполненными сюда не входят. */
export function activeSignals(signals: readonly Signal[]): Signal[] {
  return signals.filter((s) => !s.acked);
}

/** Отмеченные выполненными — показываются отдельно и не считаются в счётчике. */
export function ackedSignals(signals: readonly Signal[]): Signal[] {
  return signals.filter((s) => s.acked);
}

// --- Риск ликвидации и слепота -------------------------------------------

function riskSignals(input: SignalsInput, nowMs: number): SignalDraft[] {
  const out: SignalDraft[] = [];

  if (input.runtime.debtError !== null) {
    out.push({
      key: "debt-unavailable",
      kind: "debt-unavailable",
      severity: "liquidation",
      weight: 0,
      tone: "warn",
      chip: "нет данных",
      title: "Данные о долге не загрузились",
      detail: input.runtime.debtError,
      hint: "Неизвестный запас до ликвидации стоит на месте риска ликвидации, а не в конце списка.",
      target: "debt",
    });
  }

  const debt = input.debt;
  if (debt === null) return out;

  const threshold = debt.summary.hfWarningThreshold;

  // «Долг ни разу не прочитан» — только при заведённых кошельках: без них
  // долгу неоткуда взяться, и это честный ноль, а не пробел
  const hasWallets = (input.portfolio?.wallets.length ?? 0) > 0;
  if (debt.summary.totalDebtUsd === null && hasWallets) {
    out.push({
      key: "debt-unread",
      kind: "debt-unread",
      severity: "liquidation",
      weight: 0,
      tone: "warn",
      chip: "долг не читался",
      title: "Долг ни разу не прочитан",
      detail: "Отсутствие данных это не отсутствие долга.",
      hint: DEBT_UNREAD_HINT,
      target: "debt",
    });
  }

  for (const chain of debt.chains) {
    const zone = hfZone(chain.healthFactor, threshold);

    if (chain.healthFactor !== null && isDangerZone(zone)) {
      out.push(hfBelowSignal(chain, chain.healthFactor, zone, threshold));
      continue;
    }

    // HF не прочитан там, где долг есть: зона считает такой HF за «долга
    // нет», а это ровно та подмена, из-за которой молчание опаснее тревоги
    if (chain.healthFactor === null && hasDebt(chain)) {
      out.push({
        key: `hf-unread:${chain.chain}`,
        kind: "hf-unread",
        severity: "liquidation",
        weight: HF_ZONE_RANK.below,
        tone: "warn",
        chip: "HF не прочитан",
        title: `Health factor на ${chainLabel(chain.chain)} не прочитан`,
        detail: "Долг на сети есть, а запас до ликвидации неизвестен.",
        hint: null,
        target: "debt",
      });
      continue;
    }

    const staleForMs = staleFor(chain, nowMs);
    if (staleForMs !== null && hasDebt(chain)) {
      const hours = Math.floor(staleForMs / HOUR_MS);
      out.push({
        key: `hf-stale:${chain.chain}`,
        kind: "hf-stale",
        severity: "liquidation",
        weight: hours,
        tone: "warn",
        chip: `не читается ${hours} ч`,
        title: `Health factor на ${chainLabel(chain.chain)} не читается ${hours} ч`,
        detail:
          chain.healthFactor === null
            ? "Пока чтение не восстановилось, запас до ликвидации неизвестен."
            : `Пока чтение не восстановилось, запас до ликвидации неизвестен — последнее значение ${formatHf(chain.healthFactor)}.`,
        hint: `Шесть часов молчания — это два десятка пропущенных прогонов монитора; на таком сроке отсутствие данных перестаёт отличаться от спокойствия.`,
        target: "wallets",
      });
    }
  }

  return out;
}

function hfBelowSignal(
  chain: DebtChainDto,
  healthFactor: number,
  zone: HfZone,
  threshold: number,
): SignalDraft {
  const drop = liquidationDrop(healthFactor);
  const urgent = HF_ZONE_RANK[zone] >= HF_ZONE_RANK.urgent;

  return {
    key: `hf-below:${chain.chain}`,
    kind: "hf-below",
    severity: "liquidation",
    weight: HF_ZONE_RANK[zone] + Math.max(0, threshold - healthFactor),
    tone: "loss",
    chip: `HF ${formatHf(healthFactor)}`,
    // У зоны «ниже порога» сам порог — часть утверждения: без числа
    // непонятно, ниже чего именно. У 1,30 и 1,20 числа названы стратегией
    title: `Health factor ${formatHf(healthFactor)} на ${chainLabel(chain.chain)} — ${HF_ZONE_LABEL[zone]}${
      zone === "below" ? ` ${formatHfThreshold(threshold)}` : ""
    }`,
    detail: urgent
      ? `HF ниже ${formatHfThreshold(HF_URGENT)} — по стратегии на этом уровне часть GM продают и поднимают HF примерно к 1,50.`
      : drop === null
        ? `Порог предупреждения — ${formatHfThreshold(threshold)}.`
        : `До ликвидации залогу хватит падения на ${tablePct(drop * 100, 1)}.`,
    hint: `Порог ${formatHfThreshold(threshold)} настраивается, а уровни 1,30 и 1,20 заданы стратегией: HF 1,25 остаётся экстренным даже при пороге 1,10.`,
    target: "debt",
  };
}

/** На сети есть долг: и известный положительный, и заявленный HF считаются. */
function hasDebt(chain: DebtChainDto): boolean {
  if (chain.totalDebtUsd !== null && chain.totalDebtUsd > 0) return true;
  return chain.items.length > 0;
}

/** Сколько сеть молчит сверх порога слепоты; null = читается вовремя. */
function staleFor(chain: DebtChainDto, nowMs: number): number | null {
  if (chain.checkedAt === "") return null;
  const checked = Date.parse(chain.checkedAt);
  if (Number.isNaN(checked)) return null;
  const elapsed = nowMs - checked;
  return elapsed > STALE_AFTER_MS ? elapsed : null;
}

// --- Уровни GM и таймер CLMM ---------------------------------------------

function positionSignals(input: SignalsInput, nowMs: number): SignalDraft[] {
  const positions = input.positions;
  if (positions === null) return [];

  const out: SignalDraft[] = [];
  for (const position of positions) {
    // Пока журнал не прочитан, отработанность уровня неизвестна. Показать
    // сигнал сейчас и убрать через секунду — хуже, чем промолчать: лента
    // и так помечена загружающейся через hasPendingSources
    if (position.protocol === "gmx_v2" && !input.pending.journals) {
      out.push(...gmSignals(position, input.actedGmLevels?.get(position.zoneKey)));
    }
    if (position.protocol === "uni_v3") out.push(...clmmSignals(position, nowMs));
  }
  return out;
}

function gmSignals(
  position: PositionDto,
  actedLevels: ReadonlySet<number> | undefined,
): SignalDraft[] {
  const levels = gmLevels(position, actedLevels);
  const name = gmName(position, levels.marketSymbol);
  const out: SignalDraft[] = [];

  // Цена и действие — два разных факта. Самая глубокая цена без операции
  // остаётся сигналом; отмеченный уровень лента больше не показывает.
  const reached = [...levels.levels].reverse().find(
    (level) => level.reached === true && !level.acted,
  ) ?? null;
  if (reached !== null) {
    // Только самый глубокий уровень: пять строк на один пул описывали бы
    // одно и то же событие пятью голосами
    const stability =
      reached.stabilityAction === null
        ? ""
        : `; из Stability на нём ${reached.stabilityAction}`;
    out.push({
      key: `gm-level:${position.id}`,
      kind: "gm-level",
      severity: "level",
      weight: reached.dropPercent,
      tone: "warn",
      chip: dcPp(-reached.dropPercent, 0),
      title: `${name} ниже уровня ${dcPp(-reached.dropPercent, 0)} от точки отсчёта`,
      detail: `По стратегии на этом уровне ${reached.action}${stability}.`,
      hint: "Цена сейчас ниже уровня. Отработанность берётся из журнала операций владельца: приложение не выводит её из изменения стоимости пула.",
      target: "zones",
    });
  }

  if (levels.growth?.reached === true && !levels.growth.acted) {
    out.push({
      key: `gm-growth:${position.id}`,
      kind: "gm-growth",
      severity: "level",
      weight: 1,
      tone: "neutral",
      chip: dcPp(levels.growth.percent, 0),
      title: `${name} выше ориентира ${dcPp(levels.growth.percent, 0)} от точки отсчёта`,
      detail:
        "На существенном росте стратегия предусматривает первую фиксацию: часть GM продают, BTC/ETH уходят в залог, USDC — в Stability.",
      hint: "Ориентир, а не уровень действия: на промежуточных отметках роста стратегия действий не предусматривает.",
      target: "zones",
    });
  }

  return out;
}

/** «GM WBTC» — имя пула по базовому активу; без него остаётся заголовок. */
function gmName(position: PositionDto, marketSymbol: string | null): string {
  return marketSymbol === null ? position.title : `GM ${marketSymbol}`;
}

function clmmSignals(position: PositionDto, nowMs: number): SignalDraft[] {
  if (position.inRange !== false) return [];

  const name = position.title;
  const since = position.outOfRangeSince;
  const decision = since === null ? null : rangeDecision(since, nowMs);

  if (decision === null) {
    return [
      {
        key: `clmm-unknown-since:${position.id}`,
        kind: "clmm-unknown-since",
        severity: "timer",
        weight: 0,
        tone: "neutral",
        chip: "вне диапазона",
        title: `${name} вне диапазона, момент выхода не записан`,
        detail: `Отсчёт ${RANGE_WAIT_HOURS} часов пойдёт с ближайшего обновления.`,
        hint: null,
        target: "zones",
      },
    ];
  }

  const elapsed = Math.floor(decision.hoursElapsed);

  if (!decision.ready) {
    const monday = decision.postponedToMonday
      ? " Срок сдвинут на понедельник."
      : "";
    return [
      {
        key: `clmm-waiting:${position.id}`,
        kind: "clmm-waiting",
        severity: "timer",
        weight: decision.hoursElapsed,
        tone: "neutral",
        chip: `ждать ${Math.ceil(decision.hoursLeft)} ч`,
        title: `${name} вне диапазона ${elapsed} ч`,
        detail: `Правило ${RANGE_WAIT_HOURS} часов: до срока стратегия действовать не предусматривает.${monday}`,
        hint: "Отсчёт идёт от первого чтения, в котором позиция увидена вне диапазона: если она вышла между обновлениями, реальный выход был раньше.",
        target: "zones",
      },
    ];
  }

  const side = exitSide(position.components);
  const asset = position.components.find((c) => c.quantity > 0)?.symbol;

  return [
    {
      key: `clmm-ready:${position.id}`,
      kind: "clmm-ready",
      // Отпечаток — момент выхода: вернулась в диапазон и вышла снова —
      // это другое ожидание и другое решение, а не то же самое
      ackKey: `clmm-ready:${position.zoneKey}`,
      // decision !== null означает, что момент выхода разобрался; ?? здесь
      // только ради типа
      ackFingerprint: since ?? "—",
      // Вышедший срок обязан стоять выше любого идущего, каким бы долгим
      // тот ни был: там действие разблокировано, здесь ещё нет
      weight: 1000 + decision.hoursElapsed,
      severity: "timer",
      tone: "warn",
      chip: "срок вышел",
      title: `${name} вне диапазона ${elapsed} ч — срок ожидания вышел`,
      detail:
        side === "down"
          ? `Позиция целиком в ${asset ?? "базовом активе"} — по стратегии актив уходит в Growth.`
          : side === "up"
            ? "Позиция целиком в стейблах — по стратегии диапазон перезаливают."
            : "По стратегии позицию на этом сроке закрывают.",
      hint: null,
      target: "zones",
    },
  ];
}

// --- Плечо и ставки ------------------------------------------------------

function leverageSignals(input: SignalsInput): SignalDraft[] {
  const out: SignalDraft[] = [];
  out.push(...ltvSignals(input));

  const positions = input.positions;
  if (positions === null) return out;

  for (const position of positions) {
    const spread = positionSpread(position, input.stableBorrowRatePercent);
    if (spread !== null && spread < 0) {
      const rate = position.supplyRatePercent;
      const total = rate === null ? null : rate + (position.rewardsRatePercent ?? 0);
      out.push({
        key: `rate-below-borrow:${position.id}`,
        kind: "rate-below-borrow",
        severity: "leverage",
        weight: Math.abs(spread),
        tone: "warn",
        chip: dcPp(spread),
        title:
          total === null || input.stableBorrowRatePercent === null
            ? `${position.protocolLabel}: ставка ниже ставки займа`
            : `${position.protocolLabel}: ставка ${dcRate(total)} ниже ставки займа ${dcRate(input.stableBorrowRatePercent)}`,
        detail:
          "По стратегии депозит на стороннем лендинге держат, только пока его ставка выше ставки по займу.",
        hint: "Сравниваются годовые без капитализации (APR) и только стейбл-размещения: ставка в ETH — про другую валюту и другой риск.",
        target: "zones",
      });
    }

    // Сплит внутри GM осмыслен только когда пулов больше одного: у
    // единственного доля всегда 100%, отклонение от 70% вечное, а совет
    // «выровнять при следующей покупке» неисполним — выравнивать не с чем
    const gmPools = positions.filter((p) => p.protocol === "gmx_v2").length;
    if (position.protocol === "gmx_v2" && gmPools > 1) {
      const share = gmShare(position, positions);
      if (
        share.deviationPp !== null &&
        share.sharePercent !== null &&
        share.targetPercent !== null &&
        Math.abs(share.deviationPp) > GM_SHARE_TOLERANCE_PP
      ) {
        const name = gmName(position, null);
        out.push({
          key: `gm-split:${position.id}`,
          kind: "gm-split",
          severity: "leverage",
          weight: Math.abs(share.deviationPp),
          tone: "neutral",
          chip: dcPp(share.deviationPp),
          title: `Доля ${name} — ${tablePct(share.sharePercent, 1)} против цели ${tablePct(share.targetPercent, 0)}`,
          detail: "Перекос выравнивают при следующей покупке GM, а не продажей.",
          hint: "Рабочий сплит внутри GM — 70% BTC/USDC и 30% ETH/USDC (docs/07 §8); цель задана стратегией, а не настройкой.",
          target: "zones",
        });
      }
    }
  }

  return out;
}

function ltvSignals(input: SignalsInput): SignalDraft[] {
  const debt = input.debt;
  if (debt === null) return [];

  // Сумма по сетям: цель плеча одна на портфель. Неизвестное слагаемое
  // делает неизвестной сумму — LTV по части залога был бы неправдой
  let collateralUsd = 0;
  let debtUsd = 0;
  for (const chain of debt.chains) {
    if (chain.totalCollateralUsd === null || chain.totalDebtUsd === null) {
      return [];
    }
    collateralUsd += chain.totalCollateralUsd;
    debtUsd += chain.totalDebtUsd;
  }

  const rebalance = ltvRebalance(collateralUsd, debtUsd, input.targetLtvPct);
  if (rebalance === null || rebalance.action === "on-target") return [];

  const ltvPct = (debtUsd / collateralUsd) * 100;
  const deviationPp = ltvPct - input.targetLtvPct;
  if (Math.abs(deviationPp) <= LTV_TOLERANCE_PP) return [];

  const repay = rebalance.action === "repay";
  return [
    {
      key: "ltv-off-target",
      kind: "ltv-off-target",
      severity: "leverage",
      weight: Math.abs(deviationPp),
      tone: repay ? "warn" : "neutral",
      chip: `LTV ${tablePct(ltvPct, 1)}`,
      title: `LTV ${tablePct(ltvPct, 1)} — ${repay ? "выше" : "ниже"} цели ${tablePct(input.targetLtvPct, 0)}`,
      detail: repay
        ? `До цели долг больше на ${dcUsd(Math.abs(rebalance.deltaUsd))}.`
        : `До цели остаётся ${dcUsd(rebalance.deltaUsd)} займа — по стратегии их направляют в Yield по рабочему сплиту.`,
      hint: "Залог считается неизменным: и погашение, и добор долга его не трогают — заёмные приходят стейблами, а они в залог не попадают.",
      target: "debt",
    },
  ];
}

// --- Гигиена данных ------------------------------------------------------

function hygieneSignals(input: SignalsInput): SignalDraft[] {
  const out: SignalDraft[] = [];

  if (input.runtime.zonesError !== null) {
    out.push({
      key: "zones-unavailable",
      kind: "zones-unavailable",
      severity: "hygiene",
      weight: 0,
      tone: "warn",
      chip: "нет данных",
      title: "Позиции и зоны не загрузились",
      detail: input.runtime.zonesError,
      hint: null,
      target: null,
    });
  }

  if (input.runtime.refreshError !== null) {
    out.push({
      key: "refresh-failed",
      kind: "refresh-failed",
      severity: "hygiene",
      weight: 0,
      tone: "warn",
      chip: "обновление не прошло",
      title: input.runtime.refreshError,
      detail: "Показаны последние успешно прочитанные данные.",
      hint: null,
      target: null,
    });
  }

  out.push(...chainsUnreadSignal(input));

  if (input.portfolio?.freshness.anyPriceStale === true) {
    out.push({
      key: "prices-stale",
      kind: "prices-stale",
      severity: "hygiene",
      weight: 0,
      tone: "warn",
      chip: "цены устарели",
      title: "Цены обновлялись давно",
      detail: "Стоимости и уровни считаются по последним известным ценам.",
      hint: null,
      target: null,
    });
  }

  const zones = input.zones;
  if (zones !== null) {
    if (
      zones.totalUsd !== null &&
      input.assetsUsd !== null &&
      Math.abs(zones.totalUsd - input.assetsUsd) >= ZONES_MISMATCH_USD
    ) {
      const gap = Math.abs(zones.totalUsd - input.assetsUsd);
      out.push({
        key: "zones-mismatch",
        kind: "zones-mismatch",
        severity: "hygiene",
        weight: gap,
        tone: "warn",
        chip: "расходится",
        title: `Сумма зон расходится с активами на ${dcUsd(gap)}`,
        detail:
          "Пока равенство не сходится, разбору по зонам верить нельзя — обычно причина в разметке позиций.",
        hint: null,
        target: "zones",
      });
    }

    if (zones.unmarkedPositions > 0) {
      out.push({
        key: "positions-unmarked",
        kind: "positions-unmarked",
        severity: "hygiene",
        weight: zones.unmarkedPositions,
        tone: "neutral",
        chip: "разметка",
        title: `${countLabel(zones.unmarkedPositions, "позиция", "позиции", "позиций")} без разметки`,
        detail:
          "Пока не указаны обе вложенные суммы, доход позиции не считается, а собственная часть занижает категорию «Стейблы».",
        hint: null,
        target: "zones",
      });
    }

    if (zones.unpricedPositions > 0) {
      out.push({
        key: "positions-unpriced",
        kind: "positions-unpriced",
        severity: "hygiene",
        weight: zones.unpricedPositions,
        tone: "neutral",
        chip: "нет оценки",
        title: `Стоимость ${countLabel(zones.unpricedPositions, "позиции", "позиций", "позиций")} не прочитана`,
        detail: "Без неё «Активы» неполны, а сверка зон недоступна.",
        hint: null,
        target: "zones",
      });
    }

    if (zones.unmarkedFree > 0) {
      out.push({
        key: "free-unmarked",
        kind: "free-unmarked",
        severity: "hygiene",
        weight: zones.unmarkedFree,
        tone: "neutral",
        chip: "разметка",
        title: `${countLabel(zones.unmarkedFree, "баланс", "баланса", "балансов")} без метки «свои / заёмные»`,
        detail:
          "Неразмеченный баланс считается своим и попадает в категории — если он заёмный, категории завышены.",
        hint: null,
        target: "zones",
      });
    }
  }

  out.push(...positionHygiene(input));
  return out;
}

function positionHygiene(input: SignalsInput): SignalDraft[] {
  const positions = input.positions;
  if (positions === null) return [];

  const out: SignalDraft[] = [];
  let hasStablePosition = false;

  for (const position of positions) {
    if (position.supplyRatePercent !== null) hasStablePosition = true;

    if (position.protocol !== "gmx_v2") continue;
    const levels = gmLevels(position);
    const name = gmName(position, levels.marketSymbol);

    if (levels.currentPriceUsd === null) {
      out.push({
        key: `gm-no-price:${position.id}`,
        kind: "gm-no-price",
        severity: "hygiene",
        weight: 0,
        tone: "neutral",
        chip: "нет цены",
        title: `Цена ${name} не прочитана`,
        detail:
          "Оракул GMX не отдал стоимость длинной стороны — уровни по этому пулу не считаются.",
        hint: null,
        target: "zones",
      });
      continue;
    }

    if (levels.entryPriceUsd === null) {
      out.push({
        key: `gm-no-entry:${position.id}`,
        kind: "gm-no-entry",
        severity: "hygiene",
        weight: 0,
        tone: "neutral",
        chip: "нет точки отсчёта",
        title: `У ${name} не задана точка отсчёта`,
        detail: `Без цены входа уровни ${dcPp(-7, 0)} / ${dcPp(-15, 0)} / ${dcPp(-30, 0)} / ${dcPp(-50, 0)} / ${dcPp(-70, 0)} не считаются.`,
        hint: null,
        target: "zones",
      });
    }
  }

  if (hasStablePosition && input.stableBorrowRatePercent === null) {
    out.push({
      key: "borrow-rate-unread",
      kind: "borrow-rate-unread",
      severity: "hygiene",
      weight: 0,
      tone: "neutral",
      chip: "нет ставки",
      title: "Ставка заёмных стейблов не прочитана",
      detail: "Сравнить с ней ставки размещения не с чем.",
      hint: null,
      target: "debt",
    });
  }

  return out;
}

/**
 * Непрочитанные сети — одной строкой. Тот же факт приходит из трёх мест
 * (ответ refresh, статусы залога и статусы свободных балансов), и три
 * строки об одной сети говорили бы одно и то же трижды.
 */
function chainsUnreadSignal(input: SignalsInput): SignalDraft[] {
  const byChain = new Map<string, string>();

  for (const status of input.portfolio?.chains ?? []) {
    if (!status.ok) byChain.set(status.chain, status.error ?? "ошибка чтения");
  }
  for (const status of input.portfolio?.freeChains ?? []) {
    if (!status.ok) byChain.set(status.chain, status.error ?? "ошибка чтения");
  }
  // Ответ refresh свежее статусов в кэше, поэтому идёт последним
  for (const issue of input.runtime.chainIssues) {
    byChain.set(issue.chain, issue.message);
  }

  if (byChain.size === 0) return [];

  const chains = [...byChain.entries()].sort(([a], [b]) => a.localeCompare(b));
  const title =
    chains.length === 1
      ? `${chainLabel(chains[0][0])} не прочитан`
      : `${countLabel(chains.length, "сеть", "сети", "сетей")} не прочитаны`;

  return [
    {
      key: "chains-unread",
      kind: "chains-unread",
      severity: "hygiene",
      weight: chains.length,
      tone: "warn",
      chip: "данные устарели",
      title,
      detail: chains
        .map(([chain, message]) => `${chainLabel(chain)}: ${message}`)
        .join(" · "),
      hint: null,
      target: null,
    },
  ];
}
