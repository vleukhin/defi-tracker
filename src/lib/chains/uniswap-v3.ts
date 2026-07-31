import "server-only";
import { erc20Abi, formatUnits, type Address } from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAIN_IDS, getChainClients, type ChainId } from "./config";
import { positionAmounts } from "./uniswap-math";
import { coingeckoIdForSymbol } from "@/lib/prices/symbol-coingecko";
import { logApiCall } from "@/lib/metrics";

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

export interface UniV3PositionReading {
  chain: ChainId;
  tokenId: string;
  poolAddress: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  /** false = позиция вне диапазона: она целиком в одном активе. */
  inRange: boolean;
  liquidity: string;
  token0: UniV3Token;
  token1: UniV3Token;
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
  }): Promise<readonly MulticallResult[]>;
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
    pools.forEach((p, i) => {
      const r = slotResults[i];
      if (r.status === "success" && Array.isArray(r.result)) {
        const sqrt = r.result[0];
        if (typeof sqrt === "bigint") sqrtByPool.set(p.toLowerCase(), sqrt);
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
  inRange: boolean;
  liquidity: string;
  token0: UniV3Token;
  token1: UniV3Token;
}

/**
 * Запись LP-позиций. external_id = tokenId NFT (уникален в пределах сети).
 * value_usd проставляет вызывающий: цены компонентов — не забота читателя.
 */
export async function persistUniswapV3Positions(
  admin: SupabaseClient,
  walletId: string,
  statuses: UniV3ChainStatus[],
  valueUsdByTokenId: Map<string, number> = new Map(),
): Promise<void> {
  const nowIso = new Date().toISOString();
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
            inRange: p.inRange,
            liquidity: p.liquidity,
            token0: p.token0,
            token1: p.token1,
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
