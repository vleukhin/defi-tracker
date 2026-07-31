import "server-only";
import { formatUnits, type Address } from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getChainClients, type ChainId } from "./config";
import { coingeckoIdForSymbol } from "@/lib/prices/symbol-coingecko";
import { logApiCall } from "@/lib/metrics";

/**
 * Депозиты Fluid Lending (Фаза 5).
 *
 * В ТЗ Фазы 5 Fluid не значился — там были только GMX и Uniswap. Но именно на
 * Fluid лежит депозит собственных стейблов и части заемных (ставка по депозиту
 * выше ставки займа на Aave), поэтому без него «Активы» не сходятся.
 *
 * Читается ОДНИМ вызовом на сеть: FluidLendingResolver.getUserPositions(user)
 * отдает и справочник fToken'ов, и позицию пользователя по каждому. Отдельно
 * перечислять fToken'ы и опрашивать балансы не нужно.
 *
 * Адрес резолвера детерминированный и совпадает на всех сетях — проверено по
 * deployments/{mainnet,arbitrum,base,polygon}/LendingResolver.json.
 * На Optimism Fluid не развернут, поэтому сеть в список не входит.
 */

/** Один и тот же адрес на mainnet / arbitrum / base / polygon. */
export const FLUID_LENDING_RESOLVER =
  "0x48D32f49aFeAEC7AE66ad7B9264f446fc11a1569" as const;

/** Сети, где Fluid развернут. Optimism отсутствует — это не упущение. */
export const FLUID_CHAINS = ["ethereum", "arbitrum", "base"] as const;
export type FluidChainId = (typeof FLUID_CHAINS)[number];

export const FLUID_SOURCE = "fluid" as const;

/**
 * getUserPositions(address) -> (fTokenDetails, userPosition)[].
 * Кортеж большой, но берем его целиком: он дает symbol/decimals/asset, иначе
 * пришлось бы добирать их отдельными вызовами.
 */
export const lendingResolverAbi = [
  {
    name: "getUserPositions",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user_", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          {
            name: "fTokenDetails",
            type: "tuple",
            components: [
              { name: "tokenAddress", type: "address" },
              { name: "eip2612Deposits", type: "bool" },
              { name: "isNativeUnderlying", type: "bool" },
              { name: "name", type: "string" },
              { name: "symbol", type: "string" },
              { name: "decimals", type: "uint256" },
              { name: "asset", type: "address" },
              { name: "totalAssets", type: "uint256" },
              { name: "totalSupply", type: "uint256" },
              { name: "convertToShares", type: "uint256" },
              { name: "convertToAssets", type: "uint256" },
              { name: "rewardsRate", type: "uint256" },
              { name: "supplyRate", type: "uint256" },
              { name: "rebalanceDifference", type: "int256" },
              {
                name: "liquidityUserSupplyData",
                type: "tuple",
                components: [
                  { name: "modeWithInterest", type: "bool" },
                  { name: "supply", type: "uint256" },
                  { name: "withdrawalLimit", type: "uint256" },
                  { name: "lastUpdateTimestamp", type: "uint256" },
                  { name: "expandPercent", type: "uint256" },
                  { name: "expandDuration", type: "uint256" },
                  { name: "baseWithdrawalLimit", type: "uint256" },
                  { name: "withdrawableUntilLimit", type: "uint256" },
                  { name: "withdrawable", type: "uint256" },
                  { name: "decayEndTimestamp", type: "uint256" },
                  { name: "decayAmount", type: "uint256" },
                ],
              },
            ],
          },
          {
            name: "userPosition",
            type: "tuple",
            components: [
              { name: "fTokenShares", type: "uint256" },
              { name: "underlyingAssets", type: "uint256" },
              { name: "underlyingBalance", type: "uint256" },
              { name: "allowance", type: "uint256" },
            ],
          },
        ],
      },
    ],
  },
] as const;

export interface FluidPositionReading {
  chain: FluidChainId;
  /** Адрес fToken — он же external_id позиции. */
  fToken: Address;
  /** Символ fToken, как его отдает резолвер (fUSDC, fwstETH). */
  fTokenSymbol: string;
  /** Символ базового актива (USDC, wstETH). */
  symbol: string;
  underlying: Address;
  decimals: number;
  coingeckoId: string | null;
  /** Депозит в единицах базового актива, сырое значение. */
  raw: bigint;
}

export interface FluidChainStatus {
  chain: FluidChainId;
  /** false = сеть или резолвер не ответили: значение НЕизвестно, не ноль. */
  ok: boolean;
  error?: string;
  positions: FluidPositionReading[];
}

/** Узкий интерфейс клиента — чтобы читатель тестировался без сети. */
export interface FluidRpcClient {
  readContract(args: {
    address: Address;
    abi: typeof lendingResolverAbi;
    functionName: "getUserPositions";
    args: readonly [Address];
  }): Promise<unknown>;
}

export interface FluidReadOptions {
  clients?: Partial<Record<FluidChainId, FluidRpcClient>>;
  logCall?: typeof logApiCall;
}

/**
 * Символ базового актива из символа fToken: Fluid называет их строго «f» +
 * тикер (fUSDC, fwstETH, fUSD₮0). Резолвер отдельного поля с символом
 * базового актива не возвращает, а добирать его вызовом symbol() по asset —
 * лишний round-trip на каждую позицию.
 */
export function underlyingSymbol(fTokenSymbol: string): string {
  return fTokenSymbol.startsWith("f") ? fTokenSymbol.slice(1) : fTokenSymbol;
}

interface RawFluidEntry {
  fTokenDetails: {
    tokenAddress: Address;
    isNativeUnderlying: boolean;
    symbol: string;
    decimals: bigint;
    asset: Address;
  };
  userPosition: { underlyingAssets: bigint };
}

function isFluidEntries(value: unknown): value is readonly RawFluidEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (e) =>
        e !== null &&
        typeof e === "object" &&
        "fTokenDetails" in e &&
        "userPosition" in e,
    )
  );
}

/**
 * Позиции Fluid на одной сети. Нулевые депозиты отбрасываются здесь же:
 * резолвер отдает вообще все fToken'ы сети, а не только те, где есть деньги.
 *
 * decimals берется из ответа резолвера. Проверено на живых контрактах
 * (fWETH/fUSDC/fUSDT/fwstETH/fweETH/fARB): decimals fToken совпадает с
 * decimals базового актива, а underlyingAssets номинирован именно в нем.
 */
export async function readChainFluid(
  client: FluidRpcClient,
  chain: FluidChainId,
  wallet: Address,
  logCall: typeof logApiCall = logApiCall,
): Promise<FluidChainStatus> {
  try {
    const result = await client.readContract({
      address: FLUID_LENDING_RESOLVER,
      abi: lendingResolverAbi,
      functionName: "getUserPositions",
      args: [wallet],
    });

    void logCall("alchemy", `fluid:${chain}`, { units: 1 });

    if (!isFluidEntries(result)) {
      // Форма ответа не та, что ожидали, — это «неизвестно», не «пусто»
      return {
        chain,
        ok: false,
        error: "unexpected result type",
        positions: [],
      };
    }

    const positions: FluidPositionReading[] = [];
    for (const entry of result) {
      const raw = entry.userPosition.underlyingAssets;
      if (raw === 0n) continue;
      const symbol = underlyingSymbol(entry.fTokenDetails.symbol);
      positions.push({
        chain,
        fToken: entry.fTokenDetails.tokenAddress,
        fTokenSymbol: entry.fTokenDetails.symbol,
        symbol,
        underlying: entry.fTokenDetails.asset,
        decimals: Number(entry.fTokenDetails.decimals),
        coingeckoId: coingeckoIdForSymbol(symbol),
        raw,
      });
    }

    return { chain, ok: true, positions };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logCall("alchemy", `fluid:${chain}`, { units: 1, ok: false });
    console.warn(`[fluid] ${chain}: не прочитан: ${message}`);
    return { chain, ok: false, error: message, positions: [] };
  }
}

/** Депозиты Fluid по всем поддерживаемым сетям; отказ сети изолирован. */
export async function readWalletFluid(
  wallet: Address,
  opts: FluidReadOptions = {},
): Promise<FluidChainStatus[]> {
  const injected = opts.clients;
  const clients = getChainClients() as unknown as Record<
    ChainId,
    FluidRpcClient
  >;
  const logCall = opts.logCall ?? logApiCall;
  return Promise.all(
    FLUID_CHAINS.map((chain) =>
      readChainFluid(injected?.[chain] ?? clients[chain], chain, wallet, logCall),
    ),
  );
}

/** JSON-полезная нагрузка позиции Fluid в protocol_positions. */
export interface FluidPositionPayload {
  kind: "fluid_supply";
  symbol: string;
  fTokenSymbol: string;
  coingeckoId: string | null;
  fToken: string;
  underlying: string;
  decimals: number;
  /** Сырое значение строкой — пересчет без потери точности. */
  raw: string;
}

/**
 * Запись депозитов в protocol_positions (та же гигиена, что у Aave):
 * external_id = адрес fToken в нижнем регистре; ненулевые — upsert,
 * исчезнувшие — delete; упавшая сеть кэш НЕ трогает.
 *
 * value_usd проставляется вызывающим (ему доступны цены), здесь пишется
 * только количество: цена — не забота читателя цепочки.
 */
export async function persistFluidPositions(
  admin: SupabaseClient,
  walletId: string,
  statuses: FluidChainStatus[],
  valueUsdByFToken: Map<string, number> = new Map(),
): Promise<void> {
  const nowIso = new Date().toISOString();
  const upserts: {
    wallet_id: string;
    protocol: string;
    chain: string;
    external_id: string;
    quantity: string;
    value_usd: number | null;
    payload: FluidPositionPayload;
    updated_at: string;
  }[] = [];

  for (const status of statuses) {
    if (!status.ok) continue;
    for (const p of status.positions) {
      const externalId = p.fToken.toLowerCase();
      upserts.push({
        wallet_id: walletId,
        protocol: FLUID_SOURCE,
        chain: p.chain,
        external_id: externalId,
        quantity: formatUnits(p.raw, p.decimals),
        value_usd: valueUsdByFToken.get(externalId) ?? null,
        payload: {
          kind: "fluid_supply",
          symbol: p.symbol,
          fTokenSymbol: p.fTokenSymbol,
          coingeckoId: p.coingeckoId,
          fToken: externalId,
          underlying: p.underlying.toLowerCase(),
          decimals: p.decimals,
          raw: p.raw.toString(),
        },
        updated_at: nowIso,
      });
    }
  }

  if (upserts.length > 0) {
    const { error } = await admin
      .from("protocol_positions")
      .upsert(upserts, { onConflict: "wallet_id,protocol,chain,external_id" });
    if (error) throw new Error(`protocol_positions (fluid) upsert: ${error.message}`);
  }

  // Закрытые депозиты: удаляем только на сетях, которые ОТВЕТИЛИ, и только
  // те строки, которых в ответе нет. Упавшая сеть сохраняет прежнее состояние.
  for (const status of statuses) {
    if (!status.ok) continue;
    const alive = status.positions.map((p) => p.fToken.toLowerCase());
    let query = admin
      .from("protocol_positions")
      .delete()
      .eq("wallet_id", walletId)
      .eq("protocol", FLUID_SOURCE)
      .eq("chain", status.chain);
    if (alive.length > 0) {
      query = query.not("external_id", "in", `(${alive.join(",")})`);
    }
    const { error } = await query;
    if (error) throw new Error(`protocol_positions (fluid) cleanup: ${error.message}`);
  }
}

/** Статус чтения Fluid по сетям — отдельный источник в chain_read_status. */
export async function persistFluidStatus(
  admin: SupabaseClient,
  walletId: string,
  statuses: FluidChainStatus[],
): Promise<void> {
  const checkedAt = new Date().toISOString();
  const { error } = await admin.from("chain_read_status").upsert(
    statuses.map((s) => ({
      wallet_id: walletId,
      source: FLUID_SOURCE,
      chain: s.chain,
      ok: s.ok,
      error: s.error ?? null,
      checked_at: checkedAt,
    })),
    { onConflict: "wallet_id,source,chain" },
  );
  if (error) throw new Error(`chain_read_status (fluid) upsert: ${error.message}`);
}
