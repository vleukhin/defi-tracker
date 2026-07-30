import "server-only";
import { erc20Abi, formatUnits, type Address } from "viem";
import {
  AaveV3Arbitrum,
  AaveV3Base,
  AaveV3Ethereum,
  AaveV3Optimism,
} from "@bgd-labs/aave-address-book";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAIN_IDS, getChainClients, type ChainId } from "./config";
import { logApiCall } from "@/lib/metrics";

/**
 * Залог (supplied collateral) Aave v3 — источник количеств для категорий
 * btc и eth.
 *
 * Принципы:
 *  * Адреса aToken'ов НИКОГДА не пишутся руками: только @bgd-labs/aave-address-book.
 *  * Читается aToken.balanceOf — он уже включает начисленные проценты
 *    (rebasing через liquidityIndex), никакой математики с индексами не нужно.
 *  * Один multicall на сеть, allowFailure: true — упавший вызов означает
 *    «неизвестно», НЕ ноль (кэш такой позиции не трогаем).
 *  * Отказ сети изолирован (ok: false + причина), остальные три считаются.
 *  * Долг (V_TOKEN) не читается вообще: учет по ТЗ независим от заемных средств.
 *  * Каждый залоговый токен оценивается ПО СВОЕЙ цене: 1 wstETH ≈ 1.2 ETH,
 *    считать его как 1 ETH нельзя.
 */

export type CollateralCategory = "btc" | "eth";

interface ReserveSpec {
  category: CollateralCategory;
  /** CoinGecko id именно этого токена (проверены запросом /simple/price). */
  coingeckoId: string;
}

/**
 * Покрываемые резервы: ключ — символ из address book'а.
 * Резерв попадает в портфель только если он есть И здесь, И в address book
 * для конкретной сети (курируемый список = защита от «оценим что попало»).
 */
export const COVERED_RESERVES: Record<string, ReserveSpec> = {
  // --- BTC-подобные ---
  WBTC: { category: "btc", coingeckoId: "wrapped-bitcoin" },
  cbBTC: { category: "btc", coingeckoId: "coinbase-wrapped-btc" },
  tBTC: { category: "btc", coingeckoId: "tbtc" },
  LBTC: { category: "btc", coingeckoId: "lombard-staked-btc" },
  eBTC: { category: "btc", coingeckoId: "ether-fi-staked-btc" },
  FBTC: { category: "btc", coingeckoId: "ignition-fbtc" },
  // --- ETH-подобные (LST/LRT оцениваются по своей цене, не 1:1 к ETH) ---
  WETH: { category: "eth", coingeckoId: "weth" },
  wstETH: { category: "eth", coingeckoId: "wrapped-steth" },
  weETH: { category: "eth", coingeckoId: "wrapped-eeth" },
  rETH: { category: "eth", coingeckoId: "rocket-pool-eth" },
  cbETH: { category: "eth", coingeckoId: "coinbase-wrapped-staked-eth" },
  osETH: { category: "eth", coingeckoId: "stakewise-v3-oseth" },
  ETHx: { category: "eth", coingeckoId: "stader-ethx" },
  rsETH: { category: "eth", coingeckoId: "kelp-dao-restaked-eth" },
  wrsETH: { category: "eth", coingeckoId: "wrapped-rseth" },
  ezETH: { category: "eth", coingeckoId: "renzo-restaked-eth" },
  tETH: { category: "eth", coingeckoId: "treehouse-eth" },
};

/** Форма записи резерва в address book (нужны только эти поля). */
interface AddressBookAsset {
  decimals: number;
  UNDERLYING: string;
  A_TOKEN: string;
}

const POOLS: Record<ChainId, Record<string, AddressBookAsset>> = {
  ethereum: AaveV3Ethereum.ASSETS,
  arbitrum: AaveV3Arbitrum.ASSETS,
  base: AaveV3Base.ASSETS,
  optimism: AaveV3Optimism.ASSETS,
};

export interface AaveReserve {
  chain: ChainId;
  symbol: string;
  category: CollateralCategory;
  coingeckoId: string;
  /** aToken — его balanceOf и читаем (уже с процентами). */
  aToken: Address;
  /** Базовый токен: для справки и для оценки по адресу при необходимости. */
  underlying: Address;
  decimals: number;
}

function buildReserves(): Record<ChainId, readonly AaveReserve[]> {
  const out = {} as Record<ChainId, AaveReserve[]>;
  for (const chain of CHAIN_IDS) {
    const assets = POOLS[chain];
    out[chain] = Object.entries(COVERED_RESERVES).flatMap(([symbol, spec]) => {
      const asset = assets[symbol];
      if (!asset) return []; // резерв не листнут в этой сети
      return [
        {
          chain,
          symbol,
          category: spec.category,
          coingeckoId: spec.coingeckoId,
          aToken: asset.A_TOKEN as Address,
          underlying: asset.UNDERLYING as Address,
          // decimals из address book'а (= из контракта), никогда не «18 по умолчанию»
          decimals: asset.decimals,
        },
      ];
    });
  }
  return out;
}

/** Покрываемые залоговые резервы по сетям (из address book, не руками). */
export const AAVE_RESERVES: Record<ChainId, readonly AaveReserve[]> =
  buildReserves();

/** Все coingecko id залоговых резервов — что просить у прайсера. */
export const AAVE_COINGECKO_IDS: readonly string[] = [
  ...new Set(
    CHAIN_IDS.flatMap((chain) => AAVE_RESERVES[chain].map((r) => r.coingeckoId)),
  ),
].sort();

export interface CollateralReading {
  chain: ChainId;
  symbol: string;
  category: CollateralCategory;
  coingeckoId: string;
  aToken: Address;
  underlying: Address;
  decimals: number;
  /** Сырое значение aToken.balanceOf (в decimals базового токена). */
  raw: bigint;
}

export interface AaveChainStatus {
  chain: ChainId;
  ok: boolean;
  /** Причина полного отказа сети (RPC down и т.п.). */
  error?: string;
  collateral: CollateralReading[];
  /** Упавшие вызовы: значение НЕизвестно, кэш этой позиции не трогаем. */
  failedReserves: { symbol: string; aToken: Address; reason: string }[];
}

/** Узкий интерфейс RPC-клиента — для инъекции моков в тестах. */
export interface AaveRpcClient {
  multicall(args: {
    contracts: readonly {
      address: Address;
      abi: typeof erc20Abi;
      functionName: "balanceOf";
      args: readonly [Address];
    }[];
    allowFailure: true;
  }): Promise<
    readonly (
      | { status: "success"; result: unknown }
      | { status: "failure"; error: Error; result?: undefined }
    )[]
  >;
}

export interface AaveReadOptions {
  clients?: Record<ChainId, AaveRpcClient>;
  logCall?: typeof logApiCall;
}

/** Один multicall aToken.balanceOf по всем покрываемым резервам одной сети. */
export async function readChainAaveCollateral(
  client: AaveRpcClient,
  chain: ChainId,
  wallet: Address,
  logCall: typeof logApiCall = logApiCall,
): Promise<AaveChainStatus> {
  const reserves = AAVE_RESERVES[chain];
  if (reserves.length === 0) {
    return { chain, ok: true, collateral: [], failedReserves: [] };
  }

  try {
    const results = await client.multicall({
      contracts: reserves.map((r) => ({
        address: r.aToken,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [wallet] as const,
      })),
      allowFailure: true,
    });

    // Один multicall = один RPC-запрос в счетчике квоты
    void logCall("alchemy", `aave:${chain}`, { units: 1 });

    const collateral: CollateralReading[] = [];
    const failedReserves: AaveChainStatus["failedReserves"] = [];

    results.forEach((res, i) => {
      const reserve = reserves[i];
      if (res.status === "success" && typeof res.result === "bigint") {
        collateral.push({ ...reserve, raw: res.result });
      } else {
        const reason =
          res.status === "failure"
            ? (res.error?.message ?? "call reverted")
            : "unexpected result type";
        // «Неизвестно», не ноль
        console.warn(
          `[aave] ${chain}: a${reserve.symbol}.balanceOf не прочитан: ${reason}`,
        );
        failedReserves.push({
          symbol: reserve.symbol,
          aToken: reserve.aToken,
          reason,
        });
      }
    });

    return { chain, ok: true, collateral, failedReserves };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logCall("alchemy", `aave:${chain}`, { units: 1, ok: false });
    console.warn(`[aave] ${chain}: сеть недоступна: ${message}`);
    return {
      chain,
      ok: false,
      error: message,
      collateral: [],
      failedReserves: [],
    };
  }
}

/** Залог кошелька на всех 4 сетях параллельно; отказ сети изолирован. */
export async function readWalletAaveCollateral(
  wallet: Address,
  opts: AaveReadOptions = {},
): Promise<AaveChainStatus[]> {
  const clients =
    opts.clients ??
    (getChainClients() as unknown as Record<ChainId, AaveRpcClient>);
  const logCall = opts.logCall ?? logApiCall;
  return Promise.all(
    CHAIN_IDS.map((chain) =>
      readChainAaveCollateral(clients[chain], chain, wallet, logCall),
    ),
  );
}

export const AAVE_PROTOCOL = "aave_v3" as const;

/** JSON-полезная нагрузка строки protocol_positions (что нужно движку). */
export interface AavePositionPayload {
  symbol: string;
  category: CollateralCategory;
  coingeckoId: string;
  aToken: string;
  underlying: string;
  decimals: number;
  /** Сырое значение как строка — на случай пересчета без потери точности. */
  raw: string;
}

/**
 * Запись залога в protocol_positions (service-role клиент):
 * external_id = адрес aToken (lowercase), quantity = количество базового
 * токена десятичной строкой, payload — символ/категория/coingecko id.
 *
 * Ненулевые — upsert; нулевые — delete (кэш не пухнет);
 * упавшие вызовы и упавшие сети НЕ трогают кэш (последнее известное состояние).
 * value_usd намеренно не пишется: оценка всегда берется из свежего кэша цен.
 */
export async function persistAaveCollateral(
  admin: SupabaseClient,
  walletId: string,
  statuses: AaveChainStatus[],
): Promise<void> {
  const nowIso = new Date().toISOString();
  const upserts: {
    wallet_id: string;
    protocol: string;
    chain: string;
    external_id: string;
    quantity: string;
    payload: AavePositionPayload;
    updated_at: string;
  }[] = [];
  const zeroByChain = new Map<ChainId, string[]>();

  for (const status of statuses) {
    if (!status.ok) continue; // сеть упала — оставляем последние известные данные
    for (const c of status.collateral) {
      const externalId = c.aToken.toLowerCase();
      if (c.raw === 0n) {
        const list = zeroByChain.get(c.chain) ?? [];
        list.push(externalId);
        zeroByChain.set(c.chain, list);
        continue;
      }
      upserts.push({
        wallet_id: walletId,
        protocol: AAVE_PROTOCOL,
        chain: c.chain,
        external_id: externalId,
        // bigint -> десятичная строка на самом краю
        quantity: formatUnits(c.raw, c.decimals),
        payload: {
          symbol: c.symbol,
          category: c.category,
          coingeckoId: c.coingeckoId,
          aToken: externalId,
          underlying: c.underlying.toLowerCase(),
          decimals: c.decimals,
          raw: c.raw.toString(),
        },
        updated_at: nowIso,
      });
    }
  }

  if (upserts.length > 0) {
    const { error } = await admin
      .from("protocol_positions")
      .upsert(upserts, { onConflict: "wallet_id,protocol,chain,external_id" });
    if (error) throw new Error(`protocol_positions upsert: ${error.message}`);
  }

  for (const [chain, externalIds] of zeroByChain) {
    const { error } = await admin
      .from("protocol_positions")
      .delete()
      .eq("wallet_id", walletId)
      .eq("protocol", AAVE_PROTOCOL)
      .eq("chain", chain)
      .in("external_id", externalIds);
    if (error) throw new Error(`protocol_positions cleanup: ${error.message}`);
  }
}

/**
 * Статус чтения сетей — чтобы GET /api/portfolio (только кэш, без RPC)
 * честно показывал деградацию: «Optimism: данные устарели (RPC down)».
 */
export async function persistChainStatus(
  admin: SupabaseClient,
  walletId: string,
  statuses: AaveChainStatus[],
): Promise<void> {
  const checkedAt = new Date().toISOString();
  const { error } = await admin.from("chain_read_status").upsert(
    statuses.map((s) => ({
      wallet_id: walletId,
      source: AAVE_PROTOCOL,
      chain: s.chain,
      ok: s.ok,
      error: s.error ?? null,
      checked_at: checkedAt,
    })),
    { onConflict: "wallet_id,source,chain" },
  );
  if (error) throw new Error(`chain_read_status upsert: ${error.message}`);
}
