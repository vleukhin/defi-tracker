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
import { COVERED_RESERVES } from "./aave";
import { isStableSymbol } from "@/lib/stables";
import { logApiCall } from "@/lib/metrics";

/**
 * Долг Aave v3 и health factor (Фаза 4, S4.1/S4.3).
 *
 * Два источника, читаемые одним multicall на сеть:
 *
 *  1. КАНОНИЧЕСКИЙ: Pool.getUserAccountData(user) — totalCollateralBase,
 *     totalDebtBase (обе в базовой валюте рынка, 8 знаков = USD) и
 *     healthFactor (1e18; uint256.max при отсутствии долга → null, «∞»).
 *     Это оракул самого Aave: именно эти числа решают судьбу ликвидации,
 *     поэтому Долг и HF берутся отсюда. Активы портфеля при этом оцениваются
 *     через CoinGecko — небольшое расхождение базисов принято осознанно.
 *
 *  2. Best-effort разбивка: V_TOKEN.balanceOf по ВСЕМ резервам address book
 *     (долг может быть в стейблах — курируемый список залога его не покроет).
 *     allowFailure: true; упавший вызов = «неизвестно», НЕ ноль.
 *
 *  3. Ставка variable-займа по стейбл-резервам (Pool.getReserveData): сколько
 *     стоят заемные деньги. По стратегии это порог, ниже которого депозит
 *     на стороннем лендинге держать незачем.
 *
 * Адреса Pool и v-токенов — только из @bgd-labs/aave-address-book.
 * Отказ сети изолирован и НЕ стирает последние известные строки здоровья.
 */

/** Адреса Pool по сетям — из address book, никогда руками. */
export const AAVE_POOLS: Record<ChainId, Address> = {
  ethereum: AaveV3Ethereum.POOL,
  arbitrum: AaveV3Arbitrum.POOL,
  base: AaveV3Base.POOL,
  optimism: AaveV3Optimism.POOL,
};

export const getUserAccountDataAbi = [
  {
    name: "getUserAccountData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
] as const;

/**
 * Pool.getReserveData(asset) — ставки рынка. Нужна одна величина,
 * currentVariableBorrowRate: по стратегии (docs/07 §3) депозит на стороннем
 * лендинге держат, только пока его ставка выше ставки по займу, а значит
 * стоимость заемных стейблов должна быть в приложении числом, а не в голове.
 *
 * Кортеж — устаревшая форма ReserveDataLegacy, которую Pool отдает ради
 * совместимости. Если на каком-то рынке форма разъедется, вызов упадет на
 * декодировании: allowFailure оставит ставку «неизвестной», и экран честно
 * покажет прочерк вместо выдуманного числа. Остальное чтение долга при этом
 * не страдает — оно идет отдельными вызовами того же multicall.
 */
export const getReserveDataAbi = [
  {
    name: "getReserveData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          {
            name: "configuration",
            type: "tuple",
            components: [{ name: "data", type: "uint256" }],
          },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentVariableBorrowRate", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
        ],
      },
    ],
  },
] as const;

export const MAX_UINT256 = 2n ** 256n - 1n;

/**
 * Ставки Aave — ray (1e27) и годовые БЕЗ капитализации (APR): 1e25 = 1%.
 * Интерфейс самого Aave показывает APY с ежесекундной капитализацией,
 * поэтому наше число у высоких ставок будет чуть ниже — это не расхождение
 * данных, а разные величины, и на экране так и подписано.
 */
const RAY_PER_PERCENT = 1e25;

/** Потолок правдоподобия: выше — признак не ставки, а мусора в декодировании. */
const MAX_PLAUSIBLE_RATE_PERCENT = 1000;

/** currentVariableBorrowRate из кортежа резерва; null = форма не та. */
export function borrowRatePercent(result: unknown): number | null {
  if (result === null || typeof result !== "object") return null;
  const raw = (result as { currentVariableBorrowRate?: unknown })
    .currentVariableBorrowRate;
  if (typeof raw !== "bigint" || raw < 0n) return null;
  const percent = Number(raw) / RAY_PER_PERCENT;
  if (!Number.isFinite(percent) || percent > MAX_PLAUSIBLE_RATE_PERCENT) {
    return null;
  }
  return percent;
}

/** База рынков Aave v3 — USD с 8 знаками (BASE_CURRENCY_UNIT = 1e8). */
const BASE_DECIMALS = 8;

/**
 * CoinGecko id для оценки разбивки долга. BTC/ETH-подобные переиспользуются
 * из курируемого списка залога; сюда добавлены мажорные стейблы и токены,
 * которые реально занимают. Резерв без id не выбрасывается: количество
 * пишется, оценка valueUsd остается null (фронт покажет только количество).
 */
const DEBT_COINGECKO_IDS: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(COVERED_RESERVES).map(([symbol, spec]) => [
      symbol,
      spec.coingeckoId,
    ]),
  ),
  // --- стейблы ---
  USDC: "usd-coin",
  // USDCn — нативный USDC на Arbitrum/Optimism (символ address book'а);
  // «USDC» там — бриджевый USDC.e, оба оцениваются по цене канонического
  USDCn: "usd-coin",
  USDbC: "bridged-usd-coin-base",
  USDT: "tether",
  DAI: "dai",
  sDAI: "savings-dai",
  GHO: "gho",
  LUSD: "liquity-usd",
  FRAX: "frax",
  sUSD: "nusd",
  crvUSD: "crvusd",
  PYUSD: "paypal-usd",
  USDe: "ethena-usde",
  sUSDe: "ethena-staked-usde",
  USDS: "usds",
  RLUSD: "ripple-usd",
  EURC: "euro-coin",
  EURS: "stasis-eurs",
  MAI: "mimatic",
  // --- прочие мажоры ---
  LINK: "chainlink",
  AAVE: "aave",
  ARB: "arbitrum",
  OP: "optimism",
  CRV: "curve-dao-token",
  UNI: "uniswap",
  MKR: "maker",
  LDO: "lido-dao",
};

/** Форма записи резерва в address book (нужные поля; V_TOKEN есть у всех). */
interface AddressBookDebtAsset {
  decimals: number;
  UNDERLYING: string;
  V_TOKEN: string;
}

const POOL_ASSETS: Record<ChainId, Record<string, AddressBookDebtAsset>> = {
  ethereum: AaveV3Ethereum.ASSETS,
  arbitrum: AaveV3Arbitrum.ASSETS,
  base: AaveV3Base.ASSETS,
  optimism: AaveV3Optimism.ASSETS,
};

export interface AaveDebtReserve {
  chain: ChainId;
  symbol: string;
  /** null = id неизвестен, разбивка отдается без оценки в USD. */
  coingeckoId: string | null;
  /** variable debt токен — его balanceOf читаем. */
  vToken: Address;
  underlying: Address;
  decimals: number;
}

function buildDebtReserves(): Record<ChainId, readonly AaveDebtReserve[]> {
  const out = {} as Record<ChainId, AaveDebtReserve[]>;
  for (const chain of CHAIN_IDS) {
    out[chain] = Object.entries(POOL_ASSETS[chain]).flatMap(
      ([symbol, asset]) => {
        if (!asset.V_TOKEN) return [];
        return [
          {
            chain,
            symbol,
            coingeckoId: DEBT_COINGECKO_IDS[symbol] ?? null,
            vToken: asset.V_TOKEN as Address,
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

/** ВСЕ резервы с v-токеном по сетям — долг может быть в любом из них. */
export const AAVE_DEBT_RESERVES: Record<ChainId, readonly AaveDebtReserve[]> =
  buildDebtReserves();

/** Канонические totals и HF рынка (из getUserAccountData). */
export interface AaveAccountData {
  totalCollateralUsd: number;
  totalDebtUsd: number;
  /** null = долга нет (контракт отдает uint256.max, «∞»). */
  healthFactor: number | null;
}

/**
 * Разбор кортежа getUserAccountData: base-величины 8-decimal → USD,
 * healthFactor 1e18 → число; uint256.max и нулевой долг → null («∞»).
 * Никогда не возвращает фейковое огромное число вместо бесконечности.
 */
export function mapAccountData(result: readonly bigint[]): AaveAccountData {
  const [totalCollateralBase, totalDebtBase, , , , healthFactor] = result;
  return {
    totalCollateralUsd: Number(formatUnits(totalCollateralBase, BASE_DECIMALS)),
    totalDebtUsd: Number(formatUnits(totalDebtBase, BASE_DECIMALS)),
    healthFactor:
      totalDebtBase === 0n || healthFactor === MAX_UINT256
        ? null
        : Number(formatUnits(healthFactor, 18)),
  };
}

export interface DebtReading {
  chain: ChainId;
  symbol: string;
  coingeckoId: string | null;
  vToken: Address;
  underlying: Address;
  decimals: number;
  /** Сырое значение vToken.balanceOf (в decimals базового токена). */
  raw: bigint;
  /**
   * Ставка variable-займа на момент чтения, % годовых (APR). Читается только
   * для стейблов — ими и финансируется Yield-зона; null у остальных резервов
   * и там, где вызов не прошел.
   */
  borrowRatePercent: number | null;
}

export interface AaveDebtChainStatus {
  chain: ChainId;
  /** false = сеть не ответила вообще (RPC down). */
  ok: boolean;
  error?: string;
  /**
   * Канонические totals+HF; null — getUserAccountData не прочитан
   * (accountError), строки aave_account_health при этом НЕ трогаются.
   */
  account: AaveAccountData | null;
  accountError?: string;
  debts: DebtReading[];
  /** Упавшие v-токены: значение НЕизвестно, кэш этой позиции не трогаем. */
  failedReserves: { symbol: string; vToken: Address; reason: string }[];
}

/**
 * Узкий интерфейс RPC-клиента для инъекции моков: контракты гетерогенные
 * (Pool.getUserAccountData + erc20.balanceOf), поэтому без строгой типизации
 * массива contracts.
 */
export interface AaveDebtRpcClient {
  multicall(args: {
    contracts: readonly {
      address: Address;
      abi:
        | typeof getUserAccountDataAbi
        | typeof erc20Abi
        | typeof getReserveDataAbi;
      functionName: "getUserAccountData" | "balanceOf" | "getReserveData";
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

export interface AaveDebtReadOptions {
  clients?: Record<ChainId, AaveDebtRpcClient>;
  logCall?: typeof logApiCall;
}

/** Кортеж getUserAccountData: 6 uint256. */
function isAccountTuple(value: unknown): value is readonly bigint[] {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    value.every((v) => typeof v === "bigint")
  );
}

/**
 * Один multicall на сеть: getUserAccountData + vToken.balanceOf по всем
 * резервам + getReserveData по стейблам (ставка займа). Упавший
 * getUserAccountData оставляет account = null (health-строки не
 * перезаписываются), упавший balanceOf — «неизвестно», не ноль.
 *
 * Ставки добираются тем же multicall, а не вторым запросом: счетчик квоты
 * считает запросы, а не вызовы внутри них, и лишний round-trip на каждую
 * сеть при каждом обновлении не нужен.
 */
export async function readChainAaveDebt(
  client: AaveDebtRpcClient,
  chain: ChainId,
  wallet: Address,
  logCall: typeof logApiCall = logApiCall,
): Promise<AaveDebtChainStatus> {
  const reserves = AAVE_DEBT_RESERVES[chain];
  // Ставка нужна только по стейблам: ими финансируется Yield-зона, и только
  // с ними сравнима ставка стейбл-депозита
  const rateReserves = reserves.filter((r) => isStableSymbol(r.symbol));

  try {
    const results = await client.multicall({
      contracts: [
        {
          address: AAVE_POOLS[chain],
          abi: getUserAccountDataAbi,
          functionName: "getUserAccountData" as const,
          args: [wallet] as const,
        },
        ...reserves.map((r) => ({
          address: r.vToken,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [wallet] as const,
        })),
        ...rateReserves.map((r) => ({
          address: AAVE_POOLS[chain],
          abi: getReserveDataAbi,
          functionName: "getReserveData" as const,
          args: [r.underlying] as const,
        })),
      ],
      allowFailure: true,
    });

    // Один multicall = один RPC-запрос в счетчике квоты
    void logCall("alchemy", `aave-debt:${chain}`, { units: 1 });

    const [accountRes, ...rest] = results;
    const debtRes = rest.slice(0, reserves.length);
    const rateRes = rest.slice(reserves.length);

    // Ставки по символу резерва: упавший вызов = «неизвестно», не ноль
    const ratesBySymbol = new Map<string, number>();
    rateRes.forEach((res, i) => {
      if (res.status !== "success") return;
      const percent = borrowRatePercent(res.result);
      if (percent !== null) ratesBySymbol.set(rateReserves[i].symbol, percent);
    });

    let account: AaveAccountData | null = null;
    let accountError: string | undefined;
    if (accountRes.status === "success" && isAccountTuple(accountRes.result)) {
      account = mapAccountData(accountRes.result);
    } else {
      accountError =
        accountRes.status === "failure"
          ? (accountRes.error?.message ?? "call reverted")
          : "unexpected result type";
      console.warn(
        `[aave-debt] ${chain}: getUserAccountData не прочитан: ${accountError}`,
      );
    }

    const debts: DebtReading[] = [];
    const failedReserves: AaveDebtChainStatus["failedReserves"] = [];
    debtRes.forEach((res, i) => {
      const reserve = reserves[i];
      if (res.status === "success" && typeof res.result === "bigint") {
        debts.push({
          ...reserve,
          raw: res.result,
          borrowRatePercent: ratesBySymbol.get(reserve.symbol) ?? null,
        });
      } else {
        const reason =
          res.status === "failure"
            ? (res.error?.message ?? "call reverted")
            : "unexpected result type";
        // «Неизвестно», не ноль — кэш такой позиции не трогаем
        failedReserves.push({
          symbol: reserve.symbol,
          vToken: reserve.vToken,
          reason,
        });
      }
    });

    return {
      chain,
      ok: true,
      account,
      ...(accountError ? { accountError } : {}),
      debts,
      failedReserves,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logCall("alchemy", `aave-debt:${chain}`, { units: 1, ok: false });
    console.warn(`[aave-debt] ${chain}: сеть недоступна: ${message}`);
    return {
      chain,
      ok: false,
      error: message,
      account: null,
      debts: [],
      failedReserves: [],
    };
  }
}

/** Долг кошелька на всех 4 сетях параллельно; отказ сети изолирован. */
export async function readWalletAaveDebt(
  wallet: Address,
  opts: AaveDebtReadOptions = {},
): Promise<AaveDebtChainStatus[]> {
  const clients =
    opts.clients ??
    (getChainClients() as unknown as Record<ChainId, AaveDebtRpcClient>);
  const logCall = opts.logCall ?? logApiCall;
  return Promise.all(
    CHAIN_IDS.map((chain) =>
      readChainAaveDebt(clients[chain], chain, wallet, logCall),
    ),
  );
}

export const AAVE_DEBT_SOURCE = "aave_v3_debt" as const;

/** JSON-полезная нагрузка долговой строки protocol_positions. */
export interface AaveDebtPositionPayload {
  /** Маркер: строка долга, а не залога — движок портфеля ее игнорирует. */
  kind: "debt";
  symbol: string;
  coingeckoId: string | null;
  vToken: string;
  underlying: string;
  decimals: number;
  /** Сырое значение строкой — на случай пересчета без потери точности. */
  raw: string;
  /**
   * Ставка variable-займа на момент чтения, % годовых (APR); только у
   * стейблов, у остальных резервов null. Из этих ставок складывается
   * стоимость заемных стейблов — база сравнения для ставок Yield-позиций.
   */
  borrowRatePercent: number | null;
}

/**
 * Канонические totals и HF → aave_account_health.
 * Пишутся только сети с прочитанным getUserAccountData: упавшая сеть
 * или упавший вызов НЕ стирают последние известные строки здоровья.
 */
export async function persistAaveHealth(
  admin: SupabaseClient,
  walletId: string,
  statuses: AaveDebtChainStatus[],
): Promise<void> {
  const checkedAt = new Date().toISOString();
  const rows = statuses
    .filter((s) => s.ok && s.account !== null)
    .map((s) => ({
      wallet_id: walletId,
      chain: s.chain,
      total_collateral_usd: s.account!.totalCollateralUsd,
      total_debt_usd: s.account!.totalDebtUsd,
      health_factor: s.account!.healthFactor,
      checked_at: checkedAt,
    }));
  if (rows.length === 0) return;

  const { error } = await admin
    .from("aave_account_health")
    .upsert(rows, { onConflict: "wallet_id,chain" });
  if (error) throw new Error(`aave_account_health upsert: ${error.message}`);
}

/**
 * Разбивка долга в protocol_positions (та же гигиена, что у залога):
 * external_id = адрес vToken (lowercase), ненулевые — upsert, нулевые —
 * delete; упавшие вызовы и сети кэш не трогают. Payload несет kind: 'debt' —
 * движок портфеля такие строки не видит (портфель от долга независим).
 */
export async function persistAaveDebt(
  admin: SupabaseClient,
  walletId: string,
  statuses: AaveDebtChainStatus[],
): Promise<void> {
  const nowIso = new Date().toISOString();
  const upserts: {
    wallet_id: string;
    protocol: string;
    chain: string;
    external_id: string;
    quantity: string;
    payload: AaveDebtPositionPayload;
    updated_at: string;
  }[] = [];
  const zeroByChain = new Map<ChainId, string[]>();

  for (const status of statuses) {
    if (!status.ok) continue; // сеть упала — оставляем последние известные данные
    for (const d of status.debts) {
      const externalId = d.vToken.toLowerCase();
      if (d.raw === 0n) {
        const list = zeroByChain.get(d.chain) ?? [];
        list.push(externalId);
        zeroByChain.set(d.chain, list);
        continue;
      }
      upserts.push({
        wallet_id: walletId,
        protocol: "aave_v3",
        chain: d.chain,
        external_id: externalId,
        // bigint -> десятичная строка на самом краю
        quantity: formatUnits(d.raw, d.decimals),
        payload: {
          kind: "debt",
          symbol: d.symbol,
          coingeckoId: d.coingeckoId,
          vToken: externalId,
          underlying: d.underlying.toLowerCase(),
          decimals: d.decimals,
          raw: d.raw.toString(),
          borrowRatePercent: d.borrowRatePercent,
        },
        updated_at: nowIso,
      });
    }
  }

  if (upserts.length > 0) {
    const { error } = await admin
      .from("protocol_positions")
      .upsert(upserts, { onConflict: "wallet_id,protocol,chain,external_id" });
    if (error) throw new Error(`protocol_positions (debt) upsert: ${error.message}`);
  }

  for (const [chain, externalIds] of zeroByChain) {
    const { error } = await admin
      .from("protocol_positions")
      .delete()
      .eq("wallet_id", walletId)
      .eq("protocol", "aave_v3")
      .eq("chain", chain)
      .in("external_id", externalIds);
    if (error) throw new Error(`protocol_positions (debt) cleanup: ${error.message}`);
  }
}

/**
 * Статус чтения долга по сетям (source = 'aave_v3_debt') — отдельно от
 * залога: деградируют они независимо, а снепшот и /api/debt должны честно
 * показывать «данные о долге устарели». ok = сеть ответила И канонические
 * totals прочитаны.
 */
export async function persistDebtStatus(
  admin: SupabaseClient,
  walletId: string,
  statuses: AaveDebtChainStatus[],
): Promise<void> {
  const checkedAt = new Date().toISOString();
  const { error } = await admin.from("chain_read_status").upsert(
    statuses.map((s) => ({
      wallet_id: walletId,
      source: AAVE_DEBT_SOURCE,
      chain: s.chain,
      ok: s.ok && s.account !== null,
      error: s.error ?? s.accountError ?? null,
      checked_at: checkedAt,
    })),
    { onConflict: "wallet_id,source,chain" },
  );
  if (error) throw new Error(`chain_read_status (debt) upsert: ${error.message}`);
}
