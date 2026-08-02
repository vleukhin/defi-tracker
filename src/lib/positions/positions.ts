import type {
  PositionComponentDto,
  PositionDto,
  PositionProtocol,
  PositionsSummaryDto,
  StrategyZone,
} from "@/lib/api/types";
import { buildLpRange } from "./lp-range";
import { POSITION_SOURCES, PROTOCOL_LABELS } from "./sources";
import { DEFAULT_POSITION_ZONE } from "./zones";

/**
 * Сборка размещенных позиций (Фаза 5) — чистая функция без I/O.
 *
 * Что здесь решается и почему:
 *
 *  1. Позиции НЕ входят в три категории портфеля (решение S5.1): портфель
 *     ведется по собственным средствам, а в пулах лежат заемные. Доли и
 *     отклонения от целей остаются про свои деньги.
 *
 *  2. Позиции ВХОДЯТ в «Активы» пяти чисел. Без этого Чистая = Активы − Долг
 *     занижена ровно на размещенную заемную сумму: деньги ушли в пул, долг
 *     остался в формуле, а актива, в который они превратились, нет.
 *
 *  3. Собственная доля указывается У ПОЗИЦИИ (Фаза 6). По стратегии свои
 *     стейблы всегда распределены по позициям зон Yield и Stability, и
 *     категория «Стейблы» складывается именно из этих долей. Раз своя часть
 *     попадает в категорию, стоимость позиций входит в «Активы» за ее
 *     вычетом — иначе те же деньги посчитались бы дважды.
 *
 *     Фаза 5 угадывала эту величину, вычитая ручные записи из депозита
 *     Fluid. Допущение сломалось сразу же: собственные стейблы уехали
 *     с Fluid в CLMM-позицию (docs/07 §9.4). Теперь это данные, а не
 *     догадка, и к протоколу они не привязаны.
 *
 *     null в ownUsd = «не размечено», и это НЕ ноль: после перезаливки
 *     диапазона CLMM позиция приходит без разметки. В расчет она идет как
 *     целиком заемная, но считается отдельно (unmarkedCount) и помечается
 *     в интерфейсе — молча занижать собственные средства нельзя.
 *
 * Null-пропагация как везде в проекте: неизвестная стоимость слагаемого
 * делает неизвестной сумму. Ноль вместо «нет данных» не подставляется.
 */

/** Протоколы размещения — в отличие от aave_v3, это не залог и не долг. */
export const POSITION_PROTOCOLS: PositionProtocol[] = [...POSITION_SOURCES];

/** Payload'ы, которые пишут читатели цепочек. */
interface FluidPayload {
  kind: "fluid_supply";
  symbol: string;
  fTokenSymbol: string;
  coingeckoId: string | null;
  decimals: number;
  /** Ставки на момент чтения; необязательны — строки до Фазы 7 их не хранят. */
  supplyRatePercent?: number | null;
  rewardsRatePercent?: number | null;
}
interface GmPayload {
  kind: "gmx_gm";
  marketName: string;
  gmPriceUsd: number;
  components: {
    side: "long" | "short";
    symbol: string;
    quantity: number;
    valueUsd: number;
  }[];
}
interface UniV3Payload {
  kind: "univ3_lp";
  fee: number;
  tickLower: number;
  tickUpper: number;
  inRange: boolean;
  token0: LpToken;
  token1: LpToken;
  /** Необязателен: строки, записанные до появления таймера, его не хранят. */
  outOfRangeSince?: string | null;
  /** Текущий тик пула; необязателен по той же причине. */
  tick?: number | null;
}
interface LpToken {
  symbol: string;
  coingeckoId: string | null;
  decimals: number;
  quantity: number;
  feesQuantity: number | null;
}

type PositionPayload = FluidPayload | GmPayload | UniV3Payload;

export interface PositionRowInput {
  id: string;
  protocol: string;
  chain: string;
  externalId: string;
  /** Десятичная строка из numeric. */
  quantity: string | null;
  /** Стоимость на момент чтения; для Fluid пересчитывается по свежей цене. */
  valueUsd: number | null;
  payload: unknown;
  updatedAt: string;
  walletId: string;
  walletLabel: string | null;
}

export interface BuildPositionsInput {
  rows: PositionRowInput[];
  /** Цены по coingecko id (только кэш). */
  pricesUsd: Map<string, number>;
  /** Разметка по натуральному ключу позиции; отсутствие = умолчания. */
  marksByKey?: Map<string, PositionMark>;
}

/** Пользовательская разметка позиции. */
export interface PositionMark {
  /** null = зона не задана, берется умолчание. */
  zone: StrategyZone | null;
  /** Вложено своих; null = не размечено (не ноль). */
  ownPrincipalUsd: number | null;
  /** Вложено заемных; null = не размечено. */
  borrowedPrincipalUsd: number | null;
  /** Выведено из позиции по стоимости на момент вывода; null = ноль. */
  withdrawnUsd: number | null;
}

/**
 * Разложение позиции на свое, заемное и доход.
 *
 * Вычитанием «стоимость − свое» обойтись нельзя: остаток бывает и заемной
 * частью, и начисленными процентами, и убытком пула. На депозите Fluid
 * такой остаток целиком был доходом, а показывался как долг.
 *
 * Доход считается денежно-взвешенно, с учетом выводов:
 *
 *   доход = стоимость + выведено − вложено
 *
 * Иначе продажа части GM с переводом BTC/ETH в залог выглядела бы убытком,
 * хотя капитал не потерян, а переехал в Growth Zone.
 *
 * Доход относится на свое и заемное ПРОПОРЦИОНАЛЬНО вложенному — капитал
 * в позиции работает одинаково, чей бы он ни был.
 */
export function splitPosition(
  valueUsd: number | null,
  mark: PositionMark | undefined,
): {
  ownPrincipalUsd: number | null;
  borrowedPrincipalUsd: number | null;
  withdrawnUsd: number | null;
  ownCurrentUsd: number | null;
  profitUsd: number | null;
  profitPct: number | null;
} {
  const own = mark?.ownPrincipalUsd ?? null;
  const borrowed = mark?.borrowedPrincipalUsd ?? null;
  const withdrawn = mark?.withdrawnUsd ?? null;

  // Вложенное известно только когда размечены ОБЕ части: иначе непонятно,
  // доход перед нами или незаявленная заемная доля
  const principal = own !== null && borrowed !== null ? own + borrowed : null;

  // Отсутствие выводов — обычное состояние, поэтому null здесь равен нулю
  // (в отличие от вложенного, где null означает «не сказали»)
  const profitUsd =
    valueUsd !== null && principal !== null
      ? valueUsd + (withdrawn ?? 0) - principal
      : null;
  const profitPct =
    profitUsd !== null && principal !== null && principal > 0
      ? (profitUsd / principal) * 100
      : null;

  let ownCurrentUsd: number | null;
  if (own === null) {
    // Не размечено — считаем целиком заемной, но позиция помечена в интерфейсе
    ownCurrentUsd = 0;
  } else if (principal === null || principal === 0) {
    // Заемная часть неизвестна: доход не распределяем, берем вложенное как есть
    ownCurrentUsd = own;
  } else {
    ownCurrentUsd = valueUsd === null ? null : (valueUsd * own) / principal;
  }

  return {
    ownPrincipalUsd: own,
    borrowedPrincipalUsd: borrowed,
    withdrawnUsd: withdrawn,
    ownCurrentUsd,
    profitUsd,
    profitPct,
  };
}

/**
 * Натуральный ключ разметки позиции. Не id строки: читатель пересоздает
 * строки, а CLMM при перезаливке диапазона выдает новый tokenId.
 */
export function zoneKeyOf(row: {
  protocol: string;
  chain: string;
  externalId: string;
}): string {
  return `${row.protocol}:${row.chain}:${row.externalId}`;
}

export interface BuildPositionsResult {
  positions: PositionDto[];
  summary: PositionsSummaryDto;
}

const isProtocol = (p: string): p is PositionProtocol =>
  p === "fluid" || p === "gmx_v2" || p === "uni_v3";

function payloadOf(value: unknown): PositionPayload | null {
  if (value === null || typeof value !== "object") return null;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "fluid_supply" || kind === "gmx_gm" || kind === "univ3_lp") {
    return value as PositionPayload;
  }
  return null;
}

/** Доля процента комиссии из fee tier Uniswap (500 => 0,05%). */
function feeLabel(fee: number): string {
  return `${(fee / 10_000).toString().replace(".", ",")}%`;
}

/** Сумма с null-пропагацией: неизвестное слагаемое — неизвестная сумма. */
function sumOrNull(values: (number | null)[]): number | null {
  let sum = 0;
  for (const v of values) {
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

function buildFluid(
  row: PositionRowInput,
  payload: FluidPayload,
  prices: Map<string, number>,
  mark: PositionMark | undefined,
): PositionDto {
  const quantity = row.quantity === null ? null : Number(row.quantity);
  const price =
    payload.coingeckoId !== null ? prices.get(payload.coingeckoId) : undefined;

  // Депозит Fluid — это обычный баланс токена, поэтому оценивается по СВЕЖЕЙ
  // цене, как залог Aave. value_usd из БД остается запасным вариантом.
  const valueUsd =
    quantity !== null && price !== undefined
      ? quantity * price
      : row.valueUsd;

  return {
    id: row.id,
    protocol: "fluid",
    protocolLabel: PROTOCOL_LABELS.fluid,
    chain: row.chain,
    zone: mark?.zone ?? DEFAULT_POSITION_ZONE,
    zoneKey: zoneKeyOf(row),
    ...splitPosition(valueUsd, mark),
    title: payload.fTokenSymbol,
    subtitle: `Депозит ${payload.symbol}`,
    quantity: row.quantity,
    valueUsd,
    components: [
      { symbol: payload.symbol, quantity: quantity ?? 0, valueUsd, side: null },
    ],
    feesUsd: null,
    inRange: null,
    outOfRangeSince: null,
    range: null,
    // Ставка депозита — то, ради чего Fluid и держат: доход тут начисляется
    // процентом, а не переоценкой, и его сравнивают со ставкой займа
    supplyRatePercent: payload.supplyRatePercent ?? null,
    rewardsRatePercent: payload.rewardsRatePercent ?? null,
    walletId: row.walletId,
    walletLabel: row.walletLabel,
    updatedAt: row.updatedAt,
  };
}

function buildGm(
  row: PositionRowInput,
  payload: GmPayload,
  mark: PositionMark | undefined,
): PositionDto {
  // Оценка — из оракула GMX (Reader.getMarketTokenPrice): включает
  // незакрытый PnL трейдеров, чего сумма компонентов не показывает
  const valueUsd = row.valueUsd;
  const components: PositionComponentDto[] = payload.components.map((c) => ({
    symbol: c.symbol,
    quantity: c.quantity,
    valueUsd: c.valueUsd,
    side: c.side,
  }));
  return {
    id: row.id,
    protocol: "gmx_v2",
    protocolLabel: PROTOCOL_LABELS.gmx_v2,
    chain: row.chain,
    zone: mark?.zone ?? DEFAULT_POSITION_ZONE,
    zoneKey: zoneKeyOf(row),
    ...splitPosition(valueUsd, mark),
    title: `GM ${payload.marketName.split(" ")[0]}`,
    subtitle: payload.marketName,
    quantity: row.quantity,
    valueUsd,
    components,
    feesUsd: null,
    inRange: null,
    outOfRangeSince: null,
    range: null,
    // Пул не начисляет процент: доход GM считается переоценкой стоимости
    supplyRatePercent: null,
    rewardsRatePercent: null,
    walletId: row.walletId,
    walletLabel: row.walletLabel,
    updatedAt: row.updatedAt,
  };
}

function buildLp(
  row: PositionRowInput,
  payload: UniV3Payload,
  prices: Map<string, number>,
  mark: PositionMark | undefined,
): PositionDto {
  const priceOf = (t: LpToken) =>
    t.coingeckoId !== null ? (prices.get(t.coingeckoId) ?? null) : null;

  const tokens = [payload.token0, payload.token1];
  const components: PositionComponentDto[] = tokens.map((t) => {
    const price = priceOf(t);
    return {
      symbol: t.symbol,
      quantity: t.quantity,
      valueUsd: price === null ? null : t.quantity * price,
      side: null,
    };
  });

  // Стоимость LP = сумма компонентов по текущему тику: другого источника
  // цены у позиции нет, и это ровно то, что вернет вывод ликвидности
  const valueUsd = sumOrNull(components.map((c) => c.valueUsd));

  const feesUsd = sumOrNull(
    tokens.map((t) => {
      if (t.feesQuantity === null) return null; // симуляция collect не удалась
      const price = priceOf(t);
      return price === null ? null : t.feesQuantity * price;
    }),
  );

  return {
    id: row.id,
    protocol: "uni_v3",
    protocolLabel: PROTOCOL_LABELS.uni_v3,
    chain: row.chain,
    zone: mark?.zone ?? DEFAULT_POSITION_ZONE,
    zoneKey: zoneKeyOf(row),
    ...splitPosition(valueUsd, mark),
    title: `${payload.token0.symbol}/${payload.token1.symbol} ${feeLabel(payload.fee)}`,
    subtitle: payload.inRange
      ? `Тики ${payload.tickLower}…${payload.tickUpper}`
      : "Вне диапазона — позиция целиком в одном активе",
    quantity: row.quantity,
    valueUsd,
    components,
    feesUsd,
    inRange: payload.inRange,
    // В диапазоне таймер не идет: момент выхода сбрасывается читателем
    outOfRangeSince: payload.inRange ? null : (payload.outOfRangeSince ?? null),
    range: buildLpRange({
      tickLower: payload.tickLower,
      tickUpper: payload.tickUpper,
      tick: payload.tick ?? null,
      token0: payload.token0,
      token1: payload.token1,
    }),
    // У LP дохода-процента нет: он складывается из комиссий и переоценки
    supplyRatePercent: null,
    rewardsRatePercent: null,
    walletId: row.walletId,
    walletLabel: row.walletLabel,
    updatedAt: row.updatedAt,
  };
}

/**
 * coingecko id, нужные для оценки позиций.
 *
 * GM-пулы сюда не попадают: их стоимость приходит от оракула GMX и лежит
 * в value_usd — цена CoinGecko для GM-токена не существует в принципе.
 */
export function positionPriceIds(rows: PositionRowInput[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const payload = payloadOf(row.payload);
    if (payload === null) continue;
    if (payload.kind === "fluid_supply") {
      if (payload.coingeckoId) ids.push(payload.coingeckoId);
    } else if (payload.kind === "univ3_lp") {
      for (const t of [payload.token0, payload.token1]) {
        if (t.coingeckoId) ids.push(t.coingeckoId);
      }
    }
  }
  return [...new Set(ids)];
}

export function buildPositions(
  input: BuildPositionsInput,
): BuildPositionsResult {
  const positions: PositionDto[] = [];
  const values: (number | null)[] = [];

  for (const row of input.rows) {
    if (!isProtocol(row.protocol)) continue;
    const payload = payloadOf(row.payload);
    if (payload === null) continue;

    const mark = input.marksByKey?.get(zoneKeyOf(row));

    const dto =
      payload.kind === "fluid_supply"
        ? buildFluid(row, payload, input.pricesUsd, mark)
        : payload.kind === "gmx_gm"
          ? buildGm(row, payload, mark)
          : buildLp(row, payload, input.pricesUsd, mark);

    positions.push(dto);
    values.push(dto.valueUsd);
  }

  // Крупные позиции сверху; неоцененные — в конец, но не теряются
  positions.sort(
    (a, b) =>
      (b.valueUsd ?? -1) - (a.valueUsd ?? -1) || a.title.localeCompare(b.title),
  );

  const grossUsd = sumOrNull(values);
  // Неразмеченная позиция считается целиком заемной — решение принято
  // осознанно: иначе до первой разметки дашборд был бы пустым. Ее видно
  // по unmarkedCount и по пометке на карточке.
  const ownUsd = positions.reduce((s, p) => s + (p.ownCurrentUsd ?? 0), 0);
  // Доход по портфелю позиций известен, только если размечены все:
  // частичная сумма выглядела бы как маленький доход, а это ложь
  const profitUsd = sumOrNull(positions.map((p) => p.profitUsd));

  return {
    positions,
    summary: {
      // Вклад в Активы = стоимость позиций минус своя доля внутри них:
      // та уже посчитана категорией «Стейблы»
      positionsUsd: grossUsd === null ? null : grossUsd - ownUsd,
      grossUsd,
      ownUsd,
      profitUsd,
      unpricedCount: positions.filter((p) => p.valueUsd === null).length,
      unmarkedCount: positions.filter(
        (p) => p.ownPrincipalUsd === null || p.borrowedPrincipalUsd === null,
      ).length,
    },
  };
}
