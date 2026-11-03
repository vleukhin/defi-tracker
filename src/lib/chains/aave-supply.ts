import "server-only";
import { erc20Abi, formatUnits, type Address } from "viem";
import {
  AaveV3Arbitrum,
  AaveV3Base,
  AaveV3Ethereum,
  AaveV3Optimism,
} from "@bgd-labs/aave-address-book";
import type { SupabaseClient } from "@supabase/supabase-js";
import { closeVanishedPositions } from "./closures";
import { CHAIN_IDS, getChainClients, type ChainId } from "./config";
import { AAVE_POOLS, getReserveDataAbi, supplyRatePercent } from "./aave-debt";
import { AAVE_SUPPLY_SOURCE } from "@/lib/positions/sources";
import { coingeckoIdForSymbol } from "@/lib/prices/symbol-coingecko";
import { isStableSymbol } from "@/lib/stables";
import { logApiCall } from "@/lib/metrics";

/**
 * Депозит СТЕЙБЛОВ на Aave v3 — пятый протокол размещения.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ КОНТУР РЯДОМ С chains/aave.ts. Тот читает залог по
 * курируемому списку BTC- и ETH-подобных резервов: стратегия (docs/07 §1)
 * знает Aave как «залог BTC/ETH, заём в стейблах», и у залога нет ни
 * ставки, ни зоны — она по стратегии одна, Growth. Внесённые на тот же
 * рынок стейблы ведут себя иначе: доход начисляется ставкой, и держат их
 * ровно пока ставка выше ставки по займу (docs/07 §3), то есть это тот же
 * инструмент, что депозит Fluid. Поэтому они ложатся позицией
 * (protocol = 'aave_v3_supply'), а не строкой залога, и размечаются
 * на общих правах — зоной и собственной долей.
 *
 * Принципы те же, что у залога:
 *  * адреса aToken'ов и Pool — только из @bgd-labs/aave-address-book;
 *  * читается aToken.balanceOf — он уже включает начисленные проценты;
 *  * один multicall на сеть, allowFailure: true — упавший вызов означает
 *    «неизвестно», НЕ ноль (такую позицию не трогаем и не закрываем);
 *  * отказ сети изолирован, кэш остальных сетей не страдает.
 *
 * Что читается сверх баланса:
 *  * Pool.getReserveData(underlying) — currentLiquidityRate (ставка
 *    депозита) и id резерва;
 *  * Pool.getUserConfiguration(user) — бит «используется как залог» по
 *    этому id. Стейбл на Aave бывает и залогом, и просто депозитом, а
 *    разница видна только здесь: от неё зависит, держит ли он health
 *    factor. Не прочитали — null, то есть «неизвестно», а не «нет».
 */

/**
 * Pool.getUserConfiguration(user) -> (uint256 data).
 *
 * Битовая карта по индексам резервов: два бита на резерв, младший —
 * «занимает», старший — «использует как залог» (UserConfiguration.sol
 * Aave v3). Индекс резерва — это `id` из getReserveData.
 */
export const getUserConfigurationAbi = [
  {
    name: "getUserConfiguration",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [{ name: "data", type: "uint256" }],
      },
    ],
  },
] as const;

/**
 * Бит «использует как залог» для резерва с индексом reserveId.
 * null = карта или индекс неизвестны: выдумывать здесь нечего.
 */
export function usesAsCollateral(
  configData: bigint | null,
  reserveId: number | null,
): boolean | null {
  if (configData === null || reserveId === null || reserveId < 0) return null;
  const shift = BigInt(reserveId) * 2n + 1n;
  return ((configData >> shift) & 1n) === 1n;
}

/** Форма записи резерва в address book (нужны только эти поля). */
interface AddressBookAsset {
  decimals: number;
  UNDERLYING: string;
  A_TOKEN: string;
}

const POOL_ASSETS: Record<ChainId, Record<string, AddressBookAsset>> = {
  ethereum: AaveV3Ethereum.ASSETS,
  arbitrum: AaveV3Arbitrum.ASSETS,
  base: AaveV3Base.ASSETS,
  optimism: AaveV3Optimism.ASSETS,
};

export interface AaveSupplyReserve {
  chain: ChainId;
  /** Символ резерва из address book (USDC, USDCn, USD₮0). */
  symbol: string;
  /** null = id цены неизвестен: количество покажем без оценки. */
  coingeckoId: string | null;
  /** aToken — его balanceOf читаем, он же external_id позиции. */
  aToken: Address;
  underlying: Address;
  decimals: number;
}

/**
 * Стейбл-резервы по сетям — ВСЕ, что есть в address book, без своего
 * курируемого списка: курируемый список нужен залогу, чтобы не оценивать
 * «что попало» по выдуманной цене категории, а здесь отбор делает сам
 * список стейблов (lib/stables.ts), общий на всё приложение.
 */
function buildSupplyReserves(): Record<ChainId, readonly AaveSupplyReserve[]> {
  const out = {} as Record<ChainId, AaveSupplyReserve[]>;
  for (const chain of CHAIN_IDS) {
    out[chain] = Object.entries(POOL_ASSETS[chain]).flatMap(
      ([symbol, asset]) => {
        if (!asset.A_TOKEN || !isStableSymbol(symbol)) return [];
        return [
          {
            chain,
            symbol,
            coingeckoId: coingeckoIdForSymbol(symbol),
            aToken: asset.A_TOKEN as Address,
            underlying: asset.UNDERLYING as Address,
            // decimals из address book (= из контракта), не «18 по умолчанию»
            decimals: asset.decimals,
          },
        ];
      },
    );
  }
  return out;
}

export const AAVE_SUPPLY_RESERVES: Record<
  ChainId,
  readonly AaveSupplyReserve[]
> = buildSupplyReserves();

export interface AaveSupplyReading extends AaveSupplyReserve {
  /** Сырое значение aToken.balanceOf (в decimals базового токена). */
  raw: bigint;
  /** Ставка депозита на момент чтения, % годовых (APR); null = не прочитана. */
  supplyRatePercent: number | null;
  /** Держит ли этот депозит health factor; null = не прочитано. */
  usedAsCollateral: boolean | null;
}

export interface AaveSupplyChainStatus {
  chain: ChainId;
  /** false = сеть не ответила вообще: значения НЕизвестны, не нули. */
  ok: boolean;
  error?: string;
  positions: AaveSupplyReading[];
  /** Упавшие вызовы: значение НЕизвестно, позицию не трогаем. */
  failedReserves: { symbol: string; aToken: Address; reason: string }[];
}

/**
 * Узкий интерфейс RPC-клиента для инъекции моков: контракты гетерогенные
 * (Pool.getUserConfiguration + erc20.balanceOf + Pool.getReserveData),
 * поэтому без строгой типизации массива contracts — как в aave-debt.ts.
 */
export interface AaveSupplyRpcClient {
  multicall(args: {
    contracts: readonly {
      address: Address;
      abi:
        | typeof getUserConfigurationAbi
        | typeof erc20Abi
        | typeof getReserveDataAbi;
      functionName: "getUserConfiguration" | "balanceOf" | "getReserveData";
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

export interface AaveSupplyReadOptions {
  clients?: Record<ChainId, AaveSupplyRpcClient>;
  logCall?: typeof logApiCall;
}

/** uint256 data из кортежа getUserConfiguration; null = форма не та. */
function configData(result: unknown): bigint | null {
  if (result === null || typeof result !== "object") return null;
  const data = (result as { data?: unknown }).data;
  return typeof data === "bigint" ? data : null;
}

/** Индекс резерва (`id`) из кортежа getReserveData; null = форма не та. */
function reserveId(result: unknown): number | null {
  if (result === null || typeof result !== "object") return null;
  const id = (result as { id?: unknown }).id;
  return typeof id === "number" && Number.isInteger(id) ? id : null;
}

/**
 * Один multicall на сеть: конфигурация пользователя + aToken.balanceOf
 * и Pool.getReserveData по стейбл-резервам.
 *
 * Нулевые депозиты отбрасываются здесь же: резервов в address book десятки,
 * а деньги лежат в одном-двух. Упавший balanceOf нулевым НЕ считается —
 * он уходит в failedReserves, и такая позиция не закрывается.
 */
export async function readChainAaveSupply(
  client: AaveSupplyRpcClient,
  chain: ChainId,
  wallet: Address,
  logCall: typeof logApiCall = logApiCall,
): Promise<AaveSupplyChainStatus> {
  const reserves = AAVE_SUPPLY_RESERVES[chain];
  if (reserves.length === 0) {
    return { chain, ok: true, positions: [], failedReserves: [] };
  }

  try {
    const results = await client.multicall({
      contracts: [
        {
          address: AAVE_POOLS[chain],
          abi: getUserConfigurationAbi,
          functionName: "getUserConfiguration" as const,
          args: [wallet] as const,
        },
        ...reserves.map((r) => ({
          address: r.aToken,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [wallet] as const,
        })),
        ...reserves.map((r) => ({
          address: AAVE_POOLS[chain],
          abi: getReserveDataAbi,
          functionName: "getReserveData" as const,
          args: [r.underlying] as const,
        })),
      ],
      allowFailure: true,
    });

    // Один multicall = один RPC-запрос в счетчике квоты
    void logCall("alchemy", `aave-supply:${chain}`, { units: 1 });

    const [configRes, ...rest] = results;
    const balanceRes = rest.slice(0, reserves.length);
    const reserveRes = rest.slice(reserves.length);
    // Упавшая конфигурация оставляет «залог» неизвестным, но не отменяет
    // сами депозиты: количество — главное, что показывает позиция
    const config =
      configRes?.status === "success" ? configData(configRes.result) : null;

    const positions: AaveSupplyReading[] = [];
    const failedReserves: AaveSupplyChainStatus["failedReserves"] = [];

    balanceRes.forEach((res, i) => {
      const reserve = reserves[i];
      if (res.status !== "success" || typeof res.result !== "bigint") {
        const reason =
          res.status === "failure"
            ? (res.error?.message ?? "call reverted")
            : "unexpected result type";
        // «Неизвестно», не ноль
        console.warn(
          `[aave-supply] ${chain}: a${reserve.symbol}.balanceOf не прочитан: ${reason}`,
        );
        failedReserves.push({
          symbol: reserve.symbol,
          aToken: reserve.aToken,
          reason,
        });
        return;
      }
      if (res.result === 0n) return; // депозита нет — не позиция

      const data = reserveRes[i];
      const reserveResult = data?.status === "success" ? data.result : null;
      positions.push({
        ...reserve,
        raw: res.result,
        supplyRatePercent: supplyRatePercent(reserveResult),
        usedAsCollateral: usesAsCollateral(config, reserveId(reserveResult)),
      });
    });

    return { chain, ok: true, positions, failedReserves };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logCall("alchemy", `aave-supply:${chain}`, { units: 1, ok: false });
    console.warn(`[aave-supply] ${chain}: сеть недоступна: ${message}`);
    return {
      chain,
      ok: false,
      error: message,
      positions: [],
      failedReserves: [],
    };
  }
}

/** Депозиты стейблов на всех 4 сетях параллельно; отказ сети изолирован. */
export async function readWalletAaveSupply(
  wallet: Address,
  opts: AaveSupplyReadOptions = {},
): Promise<AaveSupplyChainStatus[]> {
  const clients =
    opts.clients ??
    (getChainClients() as unknown as Record<ChainId, AaveSupplyRpcClient>);
  const logCall = opts.logCall ?? logApiCall;
  return Promise.all(
    CHAIN_IDS.map((chain) =>
      readChainAaveSupply(clients[chain], chain, wallet, logCall),
    ),
  );
}

/** JSON-полезная нагрузка депозита в protocol_positions. */
export interface AaveSupplyPositionPayload {
  kind: "aave_supply";
  symbol: string;
  coingeckoId: string | null;
  aToken: string;
  underlying: string;
  decimals: number;
  /** Сырое значение строкой — пересчет без потери точности. */
  raw: string;
  /** Ставка депозита на момент чтения, % годовых; null = не прочитана. */
  supplyRatePercent: number | null;
  /** Используется как залог (держит HF); null = не прочитано. */
  usedAsCollateral: boolean | null;
}

/**
 * Запись депозитов в protocol_positions (та же гигиена, что у Fluid):
 * external_id = адрес aToken в нижнем регистре; ненулевые — upsert,
 * исчезнувшие уходят в архив закрытых и удаляются; упавшая сеть кэш
 * НЕ трогает.
 *
 * Упавший вызов тоже сохраняет позицию: его aToken идёт в «живые», иначе
 * неудачное чтение одного резерва выглядело бы выводом депозита и уносило
 * бы строку в закрытия вместе с разметкой.
 *
 * value_usd здесь не пишется: стейбл оценивается ценой из кэша при сборке
 * позиции, и цена — не забота читателя цепочки.
 */
export async function persistAaveSupply(
  admin: SupabaseClient,
  userId: string,
  walletId: string,
  statuses: AaveSupplyChainStatus[],
): Promise<void> {
  const nowIso = new Date().toISOString();
  const upserts: {
    wallet_id: string;
    protocol: string;
    chain: string;
    external_id: string;
    quantity: string;
    payload: AaveSupplyPositionPayload;
    updated_at: string;
  }[] = [];

  for (const status of statuses) {
    if (!status.ok) continue;
    for (const p of status.positions) {
      const externalId = p.aToken.toLowerCase();
      upserts.push({
        wallet_id: walletId,
        protocol: AAVE_SUPPLY_SOURCE,
        chain: p.chain,
        external_id: externalId,
        // bigint -> десятичная строка на самом краю
        quantity: formatUnits(p.raw, p.decimals),
        payload: {
          kind: "aave_supply",
          symbol: p.symbol,
          coingeckoId: p.coingeckoId,
          aToken: externalId,
          underlying: p.underlying.toLowerCase(),
          decimals: p.decimals,
          raw: p.raw.toString(),
          supplyRatePercent: p.supplyRatePercent,
          usedAsCollateral: p.usedAsCollateral,
        },
        updated_at: nowIso,
      });
    }
  }

  if (upserts.length > 0) {
    const { error } = await admin
      .from("protocol_positions")
      .upsert(upserts, { onConflict: "wallet_id,protocol,chain,external_id" });
    if (error) {
      throw new Error(`protocol_positions (aave supply) upsert: ${error.message}`);
    }
  }

  // Закрытые депозиты — только на сетях, которые ОТВЕТИЛИ, и только те
  // строки, которых в ответе нет И по которым вызов не падал
  for (const status of statuses) {
    if (!status.ok) continue;
    await closeVanishedPositions(admin, {
      userId,
      walletId,
      protocol: AAVE_SUPPLY_SOURCE,
      chain: status.chain,
      aliveExternalIds: [
        ...status.positions.map((p) => p.aToken.toLowerCase()),
        ...status.failedReserves.map((r) => r.aToken.toLowerCase()),
      ],
      closedAt: nowIso,
    });
  }
}

/**
 * Статус чтения депозитов по сетям (source = 'aave_v3_supply') — отдельно
 * от залога и долга: контуры деградируют независимо, и экран должен честно
 * показывать, чьи данные устарели.
 */
export async function persistAaveSupplyStatus(
  admin: SupabaseClient,
  walletId: string,
  statuses: AaveSupplyChainStatus[],
): Promise<void> {
  const checkedAt = new Date().toISOString();
  const { error } = await admin.from("chain_read_status").upsert(
    statuses.map((s) => ({
      wallet_id: walletId,
      source: AAVE_SUPPLY_SOURCE,
      chain: s.chain,
      ok: s.ok,
      error: s.error ?? null,
      checked_at: checkedAt,
    })),
    { onConflict: "wallet_id,source,chain" },
  );
  if (error) {
    throw new Error(`chain_read_status (aave supply) upsert: ${error.message}`);
  }
}
