import "server-only";
import { erc20Abi, formatUnits, type Address } from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAIN_IDS, getChainClients, type ChainId } from "./config";
import { blockAtTimestamp } from "./blocks";
import {
  feeGrowthInside,
  feesFromGrowth,
  positionAmounts,
} from "./uniswap-math";
import { coingeckoIdForSymbol } from "@/lib/prices/symbol-coingecko";
import { logApiCall } from "@/lib/metrics";
import type { Fees24hReason } from "@/lib/api/types";

/**
 * LP-позиции Uniswap v3 (S5.2).
 *
 * Позиции — это NFT у NonfungiblePositionManager, поэтому перечисляются
 * enumeration'ом по владельцу. Количества токенов НЕ хранятся в позиции: она
 * задана ликвидностью и границами тиков, а раскладка на token0/token1 зависит
 * от текущей цены пула. Отсюда порядок: positions() -> адрес пула -> slot0()
 * -> тик-математика.
 *
 * Позиция вне диапазона отображается как 100% одного актива — это ее реальное
 * состояние, а не ошибка чтения.
 */

export const UNIV3_SOURCE = "uni_v3" as const;

/**
 * Адреса NPM и фабрики по сетям. На Base они отличаются от остальных сетей —
 * это первая ловушка интеграции, поэтому адреса заданы явно, а не константой.
 */
export const UNIV3_ADDRESSES: Record<
  ChainId,
  { npm: Address; factory: Address }
> = {
  ethereum: {
    npm: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  },
  arbitrum: {
    npm: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  },
  optimism: {
    npm: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  },
  base: {
    npm: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
  },
};

export const npmAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "tokenOfOwnerByIndex",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "positions",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" },
    ],
  },
  {
    name: "collect",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "amount0Max", type: "uint128" },
          { name: "amount1Max", type: "uint128" },
        ],
      },
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
] as const;

export const factoryAbi = [
  {
    name: "getPool",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ type: "address" }],
  },
] as const;

export const poolAbi = [
  {
    name: "slot0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    name: "feeGrowthGlobal0X128",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "feeGrowthGlobal1X128",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    // Последнее поле, initialized — единственный прямой признак живого тика:
    // у несуществующего геттер возвращает нули, а не реверт
    name: "ticks",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tick", type: "int24" }],
    outputs: [
      { name: "liquidityGross", type: "uint128" },
      { name: "liquidityNet", type: "int128" },
      { name: "feeGrowthOutside0X128", type: "uint256" },
      { name: "feeGrowthOutside1X128", type: "uint256" },
      { name: "tickCumulativeOutside", type: "int56" },
      { name: "secondsPerLiquidityOutsideX128", type: "uint160" },
      { name: "secondsOutside", type: "uint32" },
      { name: "initialized", type: "bool" },
    ],
  },
] as const;

/** Максимум uint128 — «забрать все» при симуляции collect. */
const MAX_UINT128 = (1n << 128n) - 1n;

export interface UniV3Token {
  address: string;
  symbol: string;
  decimals: number;
  coingeckoId: string | null;
  /** Количество в позиции. */
  quantity: number;
  /** Несобранные комиссии; null = симуляция collect не удалась. */
  feesQuantity: number | null;
}

/**
 * Комиссии позиции за последние сутки.
 *
 * Считаются по аккумуляторам пула на двух блоках, а не по разнице
 * несобранного остатка: сбор комиссий внутри окна на аккумуляторы не влияет,
 * поэтому цифра верна независимо от того, забирал пользователь комиссии или
 * нет.
 *
 * Ноль здесь — содержательный ответ (позиция простояла сутки вне диапазона),
 * поэтому он приходит с ok: true, а не отказом.
 */
export type Fees24h =
  | {
      ok: true;
      /** Начислено за окно, в единицах токена. */
      token0: number;
      token1: number;
      fromBlock: number;
      toBlock: number;
      /** Фактические границы окна: до ровных суток оно не растягивается. */
      fromAt: string;
      toAt: string;
    }
  | { ok: false; reason: Fees24hReason };

export interface UniV3PositionReading {
  chain: ChainId;
  tokenId: string;
  poolAddress: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  /** Текущий тик пула; null = slot0 не прочитан. Из него цена и положение. */
  tick: number | null;
  /** false = позиция вне диапазона: она целиком в одном активе. */
  inRange: boolean;
  liquidity: string;
  token0: UniV3Token;
  token1: UniV3Token;
  /** Комиссии за последние сутки; считаются отдельным проходом. */
  fees24h: Fees24h;
}

export interface UniV3ChainStatus {
  chain: ChainId;
  /** false = не прочитано: «неизвестно», а не «позиций нет». */
  ok: boolean;
  error?: string;
  positions: UniV3PositionReading[];
}

type MulticallResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error; result?: undefined };

export interface UniV3RpcClient {
  multicall(args: {
    contracts: readonly {
      address: Address;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- контракты гетерогенные: NPM, фабрика, пул, erc20
      abi: any;
      functionName: string;
      args: readonly unknown[];
    }[];
    allowFailure: true;
    /** Пин по блоку: нужен и для «сутки назад», и для согласованного «сейчас». */
    blockNumber?: bigint;
  }): Promise<readonly MulticallResult[]>;
  /** Перевод «сутки назад» в номер блока — иначе состояние не запросить. */
  getBlock(args?: {
    blockNumber?: bigint;
  }): Promise<{ number: bigint | null; timestamp: bigint }>;
  /** Симуляция collect: комиссии иначе не узнать (в positions() они устаревшие). */
  simulateContract(args: {
    address: Address;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- тот же ABI NPM
    abi: any;
    functionName: "collect";
    args: readonly unknown[];
    account: Address;
  }): Promise<{ result: unknown }>;
}

export interface UniV3ReadOptions {
  clients?: Partial<Record<ChainId, UniV3RpcClient>>;
  logCall?: typeof logApiCall;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

interface RawPosition {
  tokenId: bigint;
  token0: Address;
  token1: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

function asPositionTuple(value: unknown): RawPosition | null {
  if (!Array.isArray(value) || value.length < 12) return null;
  return {
    tokenId: 0n, // проставляется вызывающим
    token0: value[2] as Address,
    token1: value[3] as Address,
    fee: Number(value[4]),
    tickLower: Number(value[5]),
    tickUpper: Number(value[6]),
    liquidity: value[7] as bigint,
  };
}

/** Окно, за которое считаются комиссии. */
const DAY_SECONDS = 86_400n;

/** Состояние граничного тика — все, что от него нужно аккумулятору. */
export interface TickSample {
  outside0X128: bigint;
  outside1X128: bigint;
  /**
   * У никогда не инициализированного тика геттер возвращает нули и НЕ
   * ревертит. Без этого флага такой тик выглядел бы как честный ноль, и
   * позиция получила бы выдуманные комиссии.
   */
  initialized: boolean;
}

/** Срез состояния позиции и ее пула на одном блоке. null = не прочитано. */
export interface Fees24hSample {
  tick: number | null;
  global0X128: bigint | null;
  global1X128: bigint | null;
  lower: TickSample | null;
  upper: TickSample | null;
  /** Ликвидность ЭТОЙ позиции, не пула. null = positions() отказал. */
  liquidity: bigint | null;
}

export interface Fees24hWindow {
  fromBlock: number;
  toBlock: number;
  fromAt: string;
  toAt: string;
}

/**
 * Комиссии позиции за окно из двух срезов — вся содержательная часть расчета.
 *
 * Чистая: сеть остается снаружи, поэтому ветки отказов проверяются тестами,
 * а не подбором условий на живом кошельке.
 *
 * Порядок проверок значим. Сначала отсекается общий отказ чтения: если у
 * старого среза не прочиталось состояние ПУЛА, значит архива нет, и молчание
 * positions() ничего не говорит о возрасте позиции. И только когда пул на том
 * блоке прочитан, отказ positions() означает ровно одно — позиции тогда еще
 * не было.
 */
export function fees24hFrom(
  then: Fees24hSample,
  now: Fees24hSample,
  bounds: {
    tickLower: number;
    tickUpper: number;
    decimals0: number;
    decimals1: number;
  },
  window: Fees24hWindow,
): Fees24h {
  const poolRead = (s: Fees24hSample) =>
    s.tick !== null &&
    s.global0X128 !== null &&
    s.global1X128 !== null &&
    s.lower !== null &&
    s.upper !== null;

  if (!poolRead(now) || now.liquidity === null) {
    return { ok: false, reason: "no_archive" };
  }
  if (!poolRead(then)) return { ok: false, reason: "no_archive" };
  if (then.liquidity === null) return { ok: false, reason: "too_young" };

  // Формула верна только при неизменной ликвидности. Заодно это доказывает,
  // что граничные тики не пересоздавались: ticks.clear() срабатывает лишь при
  // liquidityGross == 0, а он все окно был не меньше нашей ликвидности
  if (then.liquidity !== now.liquidity) {
    return { ok: false, reason: "liquidity_changed" };
  }
  if (
    !then.lower!.initialized ||
    !then.upper!.initialized ||
    !now.lower!.initialized ||
    !now.upper!.initialized
  ) {
    return { ok: false, reason: "tick_uninitialized" };
  }

  const insideAt = (s: Fees24hSample, token: 0 | 1) =>
    feeGrowthInside(
      s.tick!,
      bounds.tickLower,
      bounds.tickUpper,
      token === 0 ? s.global0X128! : s.global1X128!,
      token === 0 ? s.lower!.outside0X128 : s.lower!.outside1X128,
      token === 0 ? s.upper!.outside0X128 : s.upper!.outside1X128,
    );

  const raw0 = feesFromGrowth(now.liquidity, insideAt(now, 0), insideAt(then, 0));
  const raw1 = feesFromGrowth(now.liquidity, insideAt(now, 1), insideAt(then, 1));
  if (raw0 === null || raw1 === null) {
    return { ok: false, reason: "implausible" };
  }

  const token0 = Number(formatUnits(raw0, bounds.decimals0));
  const token1 = Number(formatUnits(raw1, bounds.decimals1));
  if (!Number.isFinite(token0) || !Number.isFinite(token1)) {
    return { ok: false, reason: "implausible" };
  }

  return { ok: true, token0, token1, ...window };
}

/** Позиция, для которой считаются комиссии за сутки. */
export interface Fees24hTarget {
  tokenId: bigint;
  pool: Address;
  tickLower: number;
  tickUpper: number;
  decimals0: number;
  decimals1: number;
}

const tickKey = (pool: string, tick: number) =>
  `${pool.toLowerCase()}:${tick}`;

function asTickSample(value: unknown): TickSample | null {
  if (!Array.isArray(value) || value.length < 8) return null;
  const [, , outside0, outside1, , , , initialized] = value;
  if (typeof outside0 !== "bigint" || typeof outside1 !== "bigint") return null;
  return {
    outside0X128: outside0,
    outside1X128: outside1,
    initialized: initialized === true,
  };
}

/**
 * Состояние всех позиций и их пулов на ОДНОМ блоке, одним мультиколлом.
 *
 * Пин по блоку обязателен с обеих сторон окна. Иначе на Arbitrum, где четыре
 * блока в секунду, feeGrowthGlobal успевал бы приехать с одного блока, а
 * feeGrowthOutside — с другого, и «сейчас» оказывалось бы тихо несогласованным.
 *
 * Ключи разные, потому что и сущности разные: slot0 и глобальные аккумуляторы
 * общие для пула, feeGrowthOutside — у пары (пул, тик), ликвидность — у
 * конкретного NFT. Ликвидность принадлежит своему диапазону: две позиции
 * в одном пуле с разными границами зарабатывают по-разному.
 */
async function readStateAtBlock(
  client: UniV3RpcClient,
  npm: Address,
  targets: Fees24hTarget[],
  blockNumber: bigint,
): Promise<Map<string, Fees24hSample>> {
  const pools = [...new Set(targets.map((t) => t.pool.toLowerCase()))];

  const tickRefs: { pool: string; tick: number }[] = [];
  const seenTicks = new Set<string>();
  for (const t of targets) {
    for (const tick of [t.tickLower, t.tickUpper]) {
      const key = tickKey(t.pool, tick);
      if (seenTicks.has(key)) continue;
      seenTicks.add(key);
      tickRefs.push({ pool: t.pool.toLowerCase(), tick });
    }
  }

  const poolCall = (functionName: string) =>
    pools.map((p) => ({
      address: p as Address,
      abi: poolAbi,
      functionName,
      args: [] as const,
    }));

  const results = await client.multicall({
    contracts: [
      ...poolCall("slot0"),
      ...poolCall("feeGrowthGlobal0X128"),
      ...poolCall("feeGrowthGlobal1X128"),
      ...tickRefs.map((r) => ({
        address: r.pool as Address,
        abi: poolAbi,
        functionName: "ticks",
        args: [r.tick] as const,
      })),
      ...targets.map((t) => ({
        address: npm,
        abi: npmAbi,
        functionName: "positions",
        args: [t.tokenId] as const,
      })),
    ],
    allowFailure: true,
    blockNumber,
  });

  const P = pools.length;
  const at = (i: number) => results[i];
  const bigintAt = (i: number): bigint | null => {
    const r = at(i);
    return r?.status === "success" && typeof r.result === "bigint"
      ? r.result
      : null;
  };

  const tickByPool = new Map<string, number>();
  const global0 = new Map<string, bigint>();
  const global1 = new Map<string, bigint>();
  pools.forEach((p, i) => {
    const slot = at(i);
    if (slot?.status === "success" && Array.isArray(slot.result)) {
      const tick = slot.result[1];
      if (typeof tick === "number") tickByPool.set(p, tick);
    }
    const g0 = bigintAt(P + i);
    if (g0 !== null) global0.set(p, g0);
    const g1 = bigintAt(2 * P + i);
    if (g1 !== null) global1.set(p, g1);
  });

  const ticks = new Map<string, TickSample>();
  tickRefs.forEach((r, i) => {
    const parsed = asTickSample(at(3 * P + i)?.result);
    if (parsed !== null) ticks.set(tickKey(r.pool, r.tick), parsed);
  });

  const liquidity = new Map<string, bigint>();
  targets.forEach((t, i) => {
    const r = at(3 * P + tickRefs.length + i);
    if (r?.status !== "success") return;
    const parsed = asPositionTuple(r.result);
    if (parsed !== null) liquidity.set(t.tokenId.toString(), parsed.liquidity);
  });

  const byToken = new Map<string, Fees24hSample>();
  for (const t of targets) {
    const pool = t.pool.toLowerCase();
    byToken.set(t.tokenId.toString(), {
      tick: tickByPool.get(pool) ?? null,
      global0X128: global0.get(pool) ?? null,
      global1X128: global1.get(pool) ?? null,
      lower: ticks.get(tickKey(pool, t.tickLower)) ?? null,
      upper: ticks.get(tickKey(pool, t.tickUpper)) ?? null,
      liquidity: liquidity.get(t.tokenId.toString()) ?? null,
    });
  }
  return byToken;
}

/**
 * Комиссии за сутки по всем позициям сети. НИКОГДА не бросает.
 *
 * Это не осторожность, а требование: голый throw отсюда попал бы во внешний
 * catch читателя, тот вернул бы ok: false с пустым списком, и отсутствие
 * архивного узла стирало бы карточку LP целиком — вместе со стоимостью,
 * составом и диапазоном. Та же дисциплина изолированных контуров, что
 * в POST /api/refresh, только уровнем ниже.
 *
 * Ключ результата — tokenId, а не адрес пула: в одном пуле у кошелька бывает
 * несколько позиций с разными диапазонами.
 */
export async function readFees24h(
  client: UniV3RpcClient,
  chain: ChainId,
  targets: Fees24hTarget[],
  logCall: typeof logApiCall = logApiCall,
): Promise<Map<string, Fees24h>> {
  const fallback = (reason: Fees24hReason) =>
    new Map(targets.map((t) => [t.tokenId.toString(), { ok: false as const, reason }]));

  if (targets.length === 0) return new Map();

  try {
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const window = await blockAtTimestamp(client, nowSec - DAY_SECONDS);
    // Окно вырождено: цепочка моложе суток либо голова не прочиталась
    if (window === null || window.from.block >= window.latest.block) {
      return fallback("no_archive");
    }

    const { npm } = UNIV3_ADDRESSES[chain];
    const [then, now] = await Promise.all([
      readStateAtBlock(client, npm, targets, window.from.block),
      readStateAtBlock(client, npm, targets, window.latest.block),
    ]);
    void logCall("alchemy", `univ3:${chain}:fees24h`, { units: 2 });

    const asIso = (sec: bigint) => new Date(Number(sec) * 1000).toISOString();
    const bounds: Fees24hWindow = {
      fromBlock: Number(window.from.block),
      toBlock: Number(window.latest.block),
      fromAt: asIso(window.from.timestamp),
      toAt: asIso(window.latest.timestamp),
    };

    const out = new Map<string, Fees24h>();
    for (const t of targets) {
      const key = t.tokenId.toString();
      const a = then.get(key);
      const b = now.get(key);
      out.set(
        key,
        a === undefined || b === undefined
          ? { ok: false, reason: "no_archive" }
          : fees24hFrom(a, b, t, bounds),
      );
    }
    return out;
  } catch (err) {
    // Текст ошибки НЕ разбираем: fallback-транспорт отдает сообщение
    // последнего провайдера в цепочке, а не того, который реально не смог
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[univ3] ${chain}: комиссии за сутки не прочитаны: ${message}`);
    void logCall("alchemy", `univ3:${chain}:fees24h`, { units: 2, ok: false });
    return fallback("no_archive");
  }
}

/**
 * LP-позиции кошелька на одной сети.
 *
 * Пять батчей: количество NFT -> их id -> состав позиций -> адреса пулов и
 * метаданные токенов -> slot0 пулов. Меньше не получится: каждый следующий
 * запрос зависит от результата предыдущего.
 */
export async function readChainUniswapV3(
  client: UniV3RpcClient,
  chain: ChainId,
  wallet: Address,
  logCall: typeof logApiCall = logApiCall,
): Promise<UniV3ChainStatus> {
  const { npm, factory } = UNIV3_ADDRESSES[chain];

  try {
    const [countRes] = await client.multicall({
      contracts: [
        {
          address: npm,
          abi: npmAbi,
          functionName: "balanceOf",
          args: [wallet],
        },
      ],
      allowFailure: true,
    });
    void logCall("alchemy", `univ3:${chain}:count`, { units: 1 });

    if (countRes.status !== "success" || typeof countRes.result !== "bigint") {
      return {
        chain,
        ok: false,
        error: "balanceOf(NPM) не прочитан",
        positions: [],
      };
    }
    const count = Number(countRes.result);
    if (count === 0) return { chain, ok: true, positions: [] };

    // id всех NFT владельца
    const idResults = await client.multicall({
      contracts: Array.from({ length: count }, (_, i) => ({
        address: npm,
        abi: npmAbi,
        functionName: "tokenOfOwnerByIndex",
        args: [wallet, BigInt(i)],
      })),
      allowFailure: true,
    });
    void logCall("alchemy", `univ3:${chain}:ids`, { units: 1 });

    const tokenIds = idResults.flatMap((r) =>
      r.status === "success" && typeof r.result === "bigint" ? [r.result] : [],
    );
    if (tokenIds.length === 0) return { chain, ok: true, positions: [] };

    // Состав позиций
    const posResults = await client.multicall({
      contracts: tokenIds.map((id) => ({
        address: npm,
        abi: npmAbi,
        functionName: "positions",
        args: [id],
      })),
      allowFailure: true,
    });
    void logCall("alchemy", `univ3:${chain}:positions`, { units: 1 });

    const raw: RawPosition[] = [];
    posResults.forEach((r, i) => {
      if (r.status !== "success") return;
      const parsed = asPositionTuple(r.result);
      // Полностью выведенная позиция (ликвидность 0) — это закрытый NFT,
      // держать его в списке позиций смысла нет
      if (!parsed || parsed.liquidity === 0n) return;
      raw.push({ ...parsed, tokenId: tokenIds[i] });
    });
    if (raw.length === 0) return { chain, ok: true, positions: [] };

    // Адреса пулов + метаданные уникальных токенов
    const uniqueTokens = [
      ...new Set(raw.flatMap((p) => [p.token0.toLowerCase(), p.token1.toLowerCase()])),
    ];
    const metaResults = await client.multicall({
      contracts: [
        ...raw.map((p) => ({
          address: factory,
          abi: factoryAbi,
          functionName: "getPool",
          args: [p.token0, p.token1, p.fee],
        })),
        ...uniqueTokens.map((t) => ({
          address: t as Address,
          abi: erc20Abi,
          functionName: "symbol",
          args: [] as const,
        })),
        ...uniqueTokens.map((t) => ({
          address: t as Address,
          abi: erc20Abi,
          functionName: "decimals",
          args: [] as const,
        })),
      ],
      allowFailure: true,
    });
    void logCall("alchemy", `univ3:${chain}:meta`, { units: 1 });

    const poolAddresses = raw.map((_, i) => {
      const r = metaResults[i];
      return r.status === "success" && typeof r.result === "string"
        ? (r.result as Address)
        : null;
    });
    const symbolByToken = new Map<string, string>();
    const decimalsByToken = new Map<string, number>();
    uniqueTokens.forEach((t, i) => {
      const symRes = metaResults[raw.length + i];
      const decRes = metaResults[raw.length + uniqueTokens.length + i];
      if (symRes.status === "success" && typeof symRes.result === "string") {
        symbolByToken.set(t, symRes.result);
      }
      if (decRes.status === "success" && typeof decRes.result === "number") {
        decimalsByToken.set(t, decRes.result);
      }
    });

    // Текущая цена пулов
    const pools = [
      ...new Set(
        poolAddresses.filter(
          (p): p is Address => p !== null && p !== ZERO_ADDRESS,
        ),
      ),
    ];
    const slotResults = await client.multicall({
      contracts: pools.map((p) => ({
        address: p,
        abi: poolAbi,
        functionName: "slot0",
        args: [] as const,
      })),
      allowFailure: true,
    });
    void logCall("alchemy", `univ3:${chain}:slot0`, { units: 1 });

    const sqrtByPool = new Map<string, bigint>();
    // Текущий тик — там же, в slot0, вторым полем. Из него считается цена
    // в человеческих единицах: раскладка на токены отвечает «сколько чего»,
    // но не «где цена относительно границ диапазона»
    const tickByPool = new Map<string, number>();
    pools.forEach((p, i) => {
      const r = slotResults[i];
      if (r.status === "success" && Array.isArray(r.result)) {
        const sqrt = r.result[0];
        if (typeof sqrt === "bigint") sqrtByPool.set(p.toLowerCase(), sqrt);
        const tick = r.result[1];
        if (typeof tick === "number") tickByPool.set(p.toLowerCase(), tick);
      }
    });

    // Несобранные комиссии: только симуляция collect дает актуальное значение,
    // tokensOwed из positions() обновляется лишь при действиях с позицией
    const fees = await Promise.all(
      raw.map(async (p) => {
        try {
          const sim = await client.simulateContract({
            address: npm,
            abi: npmAbi,
            functionName: "collect",
            args: [
              {
                tokenId: p.tokenId,
                recipient: wallet,
                amount0Max: MAX_UINT128,
                amount1Max: MAX_UINT128,
              },
            ],
            account: wallet,
          });
          const r = sim.result;
          if (Array.isArray(r) && typeof r[0] === "bigint") {
            return { amount0: r[0] as bigint, amount1: r[1] as bigint };
          }
          return null;
        } catch {
          // Комиссии «неизвестны», а не «ноль» — так и покажем
          return null;
        }
      }),
    );
    void logCall("alchemy", `univ3:${chain}:collect`, { units: raw.length });

    // Комиссии за сутки — отдельным проходом по двум блокам. Цели собираются
    // только из позиций с известными пулом и decimals: без них считать нечего
    const targets: Fees24hTarget[] = raw.flatMap((p, i) => {
      const pool = poolAddresses[i];
      if (!pool || pool === ZERO_ADDRESS) return [];
      const d0 = decimalsByToken.get(p.token0.toLowerCase());
      const d1 = decimalsByToken.get(p.token1.toLowerCase());
      if (d0 === undefined || d1 === undefined) return [];
      return [
        {
          tokenId: p.tokenId,
          pool,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          decimals0: d0,
          decimals1: d1,
        },
      ];
    });
    const fees24hByToken = await readFees24h(client, chain, targets, logCall);

    const positions: UniV3PositionReading[] = [];
    raw.forEach((p, i) => {
      const pool = poolAddresses[i];
      if (!pool || pool === ZERO_ADDRESS) return;
      const sqrt = sqrtByPool.get(pool.toLowerCase());
      if (sqrt === undefined) return; // цена пула неизвестна — количества не выдумываем

      const t0 = p.token0.toLowerCase();
      const t1 = p.token1.toLowerCase();
      const d0 = decimalsByToken.get(t0);
      const d1 = decimalsByToken.get(t1);
      if (d0 === undefined || d1 === undefined) return; // без decimals число бессмысленно

      const amounts = positionAmounts(
        sqrt,
        p.tickLower,
        p.tickUpper,
        p.liquidity,
      );
      const fee = fees[i];
      const sym0 = symbolByToken.get(t0) ?? "?";
      const sym1 = symbolByToken.get(t1) ?? "?";

      positions.push({
        chain,
        tokenId: p.tokenId.toString(),
        poolAddress: pool.toLowerCase(),
        fee: p.fee,
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        tick: tickByPool.get(pool.toLowerCase()) ?? null,
        inRange: amounts.inRange,
        liquidity: p.liquidity.toString(),
        token0: {
          address: t0,
          symbol: sym0,
          decimals: d0,
          coingeckoId: coingeckoIdForSymbol(sym0),
          quantity: Number(formatUnits(amounts.amount0, d0)),
          feesQuantity:
            fee === null ? null : Number(formatUnits(fee.amount0, d0)),
        },
        token1: {
          address: t1,
          symbol: sym1,
          decimals: d1,
          coingeckoId: coingeckoIdForSymbol(sym1),
          quantity: Number(formatUnits(amounts.amount1, d1)),
          feesQuantity:
            fee === null ? null : Number(formatUnits(fee.amount1, d1)),
        },
        fees24h: fees24hByToken.get(p.tokenId.toString()) ?? {
          ok: false,
          reason: "no_archive",
        },
      });
    });

    return { chain, ok: true, positions };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logCall("alchemy", `univ3:${chain}`, { units: 1, ok: false });
    console.warn(`[univ3] ${chain}: чтение не удалось: ${message}`);
    return { chain, ok: false, error: message, positions: [] };
  }
}

/** LP-позиции кошелька на всех сетях; отказ сети изолирован. */
export async function readWalletUniswapV3(
  wallet: Address,
  opts: UniV3ReadOptions = {},
): Promise<UniV3ChainStatus[]> {
  const clients = getChainClients() as unknown as Record<
    ChainId,
    UniV3RpcClient
  >;
  const logCall = opts.logCall ?? logApiCall;
  return Promise.all(
    CHAIN_IDS.map((chain) =>
      readChainUniswapV3(
        opts.clients?.[chain] ?? clients[chain],
        chain,
        wallet,
        logCall,
      ),
    ),
  );
}

export interface UniV3PositionPayload {
  kind: "univ3_lp";
  poolAddress: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  /** Текущий тик пула на момент чтения; null = не прочитан. */
  tick: number | null;
  inRange: boolean;
  liquidity: string;
  token0: UniV3Token;
  token1: UniV3Token;
  /**
   * Момент, с которого позиция замечена вне диапазона; null = в диапазоне.
   *
   * По стратегии (docs/07 §5, §6) после выхода из диапазона ждут ~48 часов,
   * прежде чем действовать. Сам факт выхода читается заново каждым
   * обновлением, а вот МОМЕНТ перехода невосстановим: не записали — потеряли.
   *
   * Отсчет ведется от первого чтения, в котором позиция увидена вне
   * диапазона: если она вышла между обновлениями, реальный выход был раньше.
   * Занижать срок ожидания безопаснее, чем завышать.
   */
  outOfRangeSince: string | null;
  /**
   * Комиссии за последние сутки на момент чтения.
   *
   * Правило хранения здесь ОБРАТНОЕ соседнему outOfRangeSince: то поле
   * переносится из прежней записи, потому что невосстановимо, а это —
   * пересчитывается целиком каждым обновлением. Перенести его значило бы
   * показать вчерашнюю цифру как сегодняшнюю, а это хуже, чем «неизвестно».
   */
  fees24h: Fees24h;
}

/** Прежнее состояние позиции — только то, что нужно для отсчета 48 часов. */
interface PreviousRangeState {
  inRange: boolean;
  outOfRangeSince: string | null;
}

/**
 * Момент выхода из диапазона для новой записи.
 *
 * Три случая: вернулась в диапазон — отсчет сбрасывается; вышла только что —
 * ставим текущее время; остается вне диапазона — сохраняем прежний момент,
 * иначе таймер обнулялся бы каждым обновлением и 48 часов не наступали
 * никогда.
 */
export function nextOutOfRangeSince(
  inRange: boolean,
  previous: PreviousRangeState | undefined,
  nowIso: string,
): string | null {
  if (inRange) return null;
  return previous?.outOfRangeSince ?? nowIso;
}

/**
 * Запись LP-позиций. external_id = tokenId NFT (уникален в пределах сети).
 * value_usd проставляет вызывающий: цены компонентов — не забота читателя.
 *
 * Перед записью читается предыдущее состояние диапазона: upsert переписывает
 * payload целиком, и без этого момент выхода из диапазона стирался бы каждым
 * обновлением.
 */
export async function persistUniswapV3Positions(
  admin: SupabaseClient,
  walletId: string,
  statuses: UniV3ChainStatus[],
  valueUsdByTokenId: Map<string, number> = new Map(),
): Promise<void> {
  const nowIso = new Date().toISOString();

  const previousByKey = new Map<string, PreviousRangeState>();
  const { data: existing, error: existingError } = await admin
    .from("protocol_positions")
    .select("chain, external_id, payload")
    .eq("wallet_id", walletId)
    .eq("protocol", UNIV3_SOURCE);
  if (existingError) {
    throw new Error(`protocol_positions (univ3) read: ${existingError.message}`);
  }
  for (const row of existing ?? []) {
    const payload = row.payload as Partial<UniV3PositionPayload> | null;
    if (!payload) continue;
    previousByKey.set(`${row.chain}:${row.external_id}`, {
      inRange: payload.inRange ?? true,
      outOfRangeSince: payload.outOfRangeSince ?? null,
    });
  }
  const upserts = statuses.flatMap((status) =>
    status.ok
      ? status.positions.map((p) => ({
          wallet_id: walletId,
          protocol: UNIV3_SOURCE,
          chain: p.chain,
          external_id: p.tokenId,
          // «Количество» LP-позиции — это ее ликвидность; доллары в value_usd
          quantity: p.liquidity,
          value_usd: valueUsdByTokenId.get(`${p.chain}:${p.tokenId}`) ?? null,
          payload: {
            kind: "univ3_lp" as const,
            poolAddress: p.poolAddress,
            fee: p.fee,
            tickLower: p.tickLower,
            tickUpper: p.tickUpper,
            tick: p.tick,
            inRange: p.inRange,
            liquidity: p.liquidity,
            token0: p.token0,
            token1: p.token1,
            outOfRangeSince: nextOutOfRangeSince(
              p.inRange,
              previousByKey.get(`${p.chain}:${p.tokenId}`),
              nowIso,
            ),
            // Пишется как прочиталось. В previousByKey его добавлять НЕЛЬЗЯ:
            // перенесенное значение — это вчерашние комиссии под видом
            // сегодняшних, что хуже честного «не прочитано»
            fees24h: p.fees24h,
          },
          updated_at: nowIso,
        }))
      : [],
  );

  if (upserts.length > 0) {
    const { error } = await admin
      .from("protocol_positions")
      .upsert(upserts, { onConflict: "wallet_id,protocol,chain,external_id" });
    if (error) throw new Error(`protocol_positions (univ3) upsert: ${error.message}`);
  }

  for (const status of statuses) {
    if (!status.ok) continue;
    const alive = status.positions.map((p) => p.tokenId);
    let query = admin
      .from("protocol_positions")
      .delete()
      .eq("wallet_id", walletId)
      .eq("protocol", UNIV3_SOURCE)
      .eq("chain", status.chain);
    if (alive.length > 0) {
      query = query.not("external_id", "in", `(${alive.join(",")})`);
    }
    const { error } = await query;
    if (error) throw new Error(`protocol_positions (univ3) cleanup: ${error.message}`);
  }
}

/** Статус чтения Uniswap — отдельный источник в chain_read_status. */
export async function persistUniswapV3Status(
  admin: SupabaseClient,
  walletId: string,
  statuses: UniV3ChainStatus[],
): Promise<void> {
  const checkedAt = new Date().toISOString();
  const { error } = await admin.from("chain_read_status").upsert(
    statuses.map((s) => ({
      wallet_id: walletId,
      source: UNIV3_SOURCE,
      chain: s.chain,
      ok: s.ok,
      error: s.error ?? null,
      checked_at: checkedAt,
    })),
    { onConflict: "wallet_id,source,chain" },
  );
  if (error) throw new Error(`chain_read_status (univ3) upsert: ${error.message}`);
}
