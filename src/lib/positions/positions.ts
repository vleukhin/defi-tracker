import type {
  PositionComponentDto,
  PositionDto,
  PositionProtocol,
  PositionsSummaryDto,
  StrategyZone,
} from "@/lib/api/types";
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
}
interface LpToken {
  symbol: string;
  coingeckoId: string | null;
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
  /** null = собственная доля не размечена (не ноль). */
  ownUsd: number | null;
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
    ownUsd: mark?.ownUsd ?? null,
    title: payload.fTokenSymbol,
    subtitle: `Депозит ${payload.symbol}`,
    quantity: row.quantity,
    valueUsd,
    components: [
      { symbol: payload.symbol, quantity: quantity ?? 0, valueUsd, side: null },
    ],
    feesUsd: null,
    inRange: null,
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
    ownUsd: mark?.ownUsd ?? null,
    title: `GM ${payload.marketName.split(" ")[0]}`,
    subtitle: payload.marketName,
    quantity: row.quantity,
    // Оценка — из оракула GMX (Reader.getMarketTokenPrice): включает
    // незакрытый PnL трейдеров, чего сумма компонентов не показывает
    valueUsd: row.valueUsd,
    components,
    feesUsd: null,
    inRange: null,
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
    ownUsd: mark?.ownUsd ?? null,
    title: `${payload.token0.symbol}/${payload.token1.symbol} ${feeLabel(payload.fee)}`,
    subtitle: payload.inRange
      ? `Тики ${payload.tickLower}…${payload.tickUpper}`
      : "Вне диапазона — позиция целиком в одном активе",
    quantity: row.quantity,
    valueUsd,
    components,
    feesUsd,
    inRange: payload.inRange,
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
  const ownUsd = positions.reduce((s, p) => s + (p.ownUsd ?? 0), 0);

  return {
    positions,
    summary: {
      // Вклад в Активы = стоимость позиций минус своя доля внутри них:
      // та уже посчитана категорией «Стейблы»
      positionsUsd: grossUsd === null ? null : grossUsd - ownUsd,
      grossUsd,
      ownUsd,
      unpricedCount: positions.filter((p) => p.valueUsd === null).length,
      unmarkedCount: positions.filter((p) => p.ownUsd === null).length,
    },
  };
}
