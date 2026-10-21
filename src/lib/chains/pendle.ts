import "server-only";
import { erc20Abi, formatUnits, type Address } from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { closeVanishedPositions } from "./closures";
import { CHAIN_IDS, getChainClients, type ChainId } from "./config";
import { findHeldSince } from "./pendle-held";
import { getPendleMarkets, type PendleMarket } from "@/lib/prices/pendle-api";
import { coingeckoIdForSymbol } from "@/lib/prices/symbol-coingecko";
import { PENDLE_SOURCE } from "@/lib/positions/sources";
import { logApiCall } from "@/lib/metrics";

/**
 * Позиции Pendle Finance: PT, YT и LP.
 *
 * Стратегия (docs/07 §3) держит PT в зоне Stability: это фиксированная
 * доходность на стейблах, которая к дате погашения превращается в базовый
 * актив 1:1. YT и LP — инструменты дохода, зона Yield. Все три читаются
 * одним механизмом, поэтому читаются вместе.
 *
 * Где искать — справочник рынков из API Pendle (prices/pendle-api.ts).
 * Сколько и почем — цепочка, три multicall'а на сеть:
 *   1) balanceOf по PT, YT и LP ВСЕХ рынков сети (на Ethereum их ~1500
 *      вызовов — это два RPC-запроса при увеличенном batchSize);
 *   2) только по ненулевым: курс к активу у PendlePYLpOracle, decimals
 *      токена и SY.assetInfo() — в чем этот курс выражен;
 *   3) symbol() актива — чтобы найти ему цену.
 *
 * КУРС. getPtToAssetRate / getYtToAssetRate / getLpToAssetRate отдают
 * отношение СЫРЫХ единиц актива к СЫРЫМ единицам токена, умноженное на 1e18.
 * Значит, decimals токена и актива оба входят в формулу:
 *
 *   количество актива = raw токена × rate / 1e18 / 10^decimals актива
 *
 * Проверено живыми вызовами (Ethereum, 19.10.2026, TWAP 900 с):
 *   PT-sUSDE-26NOV2026 (18 → USDe 18):   rate 0,99500e18 → 1 PT = 0,995 USDe;
 *   PT-mixUSDC-29OCT2026 (6 → USDC 6):   rate 0,99874e18 → 1 PT = 0,9987 USDC;
 *   PLP-mixUSDC-29OCT2026 (18 → USDC 6): rate 2,0957e12 — тот же курс
 *     «сырое к сырому»; без поправки на decimals LP стоил бы в 10^12 раз
 *     меньше (та же ловушка, что разобрана в euler-price-oracle#125);
 *   PT-USD3-25JUN2026 (погашен):         PT ровно 1e18, YT ровно 0.
 * Последнее важно: после погашения оракул сам отдает 1:1 для PT и ноль для
 * YT, особого случая для истекших рынков в формуле нет.
 *
 * Курс — TWAP за 15 минут, а не спот: спот одного блока двигается одной
 * сделкой, а стоимость позиции не должна прыгать от чужого свопа.
 */

/**
 * PendlePYLpOracle — один адрес на всех четырех сетях; сверено по
 * pendle-core-v2-public/deployments/{1,10,42161,8453}-core.json, ключ
 * pyYtLpOracle.
 */
export const PENDLE_ORACLE =
  "0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2" as const;

/** Pendle развернут на всех сетях проекта, оракул тоже. */
export const PENDLE_CHAINS = CHAIN_IDS;

/** Окно TWAP оракула, секунды. */
export const PENDLE_TWAP_SECONDS = 900;

/** Масштаб курса оракула. */
const RATE_SCALE = 10 ** 18;

/**
 * Размер чанка multicall в байтах calldata. По умолчанию у клиентов 1024 —
 * это ~13 вызовов balanceOf на запрос и больше сотни запросов на Ethereum.
 * 64 КБ дают ~880 вызовов на чанк; газ eth_call при этом далек от лимитов.
 */
const BALANCES_BATCH_BYTES = 65_536;

/** Нативный актив SY (ETH) приходит нулевым адресом. */
const NATIVE_ASSET = "0x0000000000000000000000000000000000000000";

export type PendleTokenType = "pt" | "yt" | "lp";

const RATE_FUNCTION: Record<PendleTokenType, string> = {
  pt: "getPtToAssetRate",
  yt: "getYtToAssetRate",
  lp: "getLpToAssetRate",
};

const rateFn = (name: string) =>
  ({
    name,
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "market", type: "address" },
      { name: "duration", type: "uint32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  }) as const;

export const pendleOracleAbi = [
  rateFn("getPtToAssetRate"),
  rateFn("getYtToAssetRate"),
  rateFn("getLpToAssetRate"),
] as const;

export const pendleSyAbi = [
  {
    name: "assetInfo",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "assetType", type: "uint8" },
      { name: "assetAddress", type: "address" },
      { name: "assetDecimals", type: "uint8" },
    ],
  },
] as const;

export interface PendlePositionReading {
  chain: ChainId;
  tokenType: PendleTokenType;
  /** Адрес токена (PT, YT или рынка для LP) — он же external_id. */
  token: string;
  market: string;
  marketName: string;
  /** Дата погашения, ISO. */
  expiry: string;
  /**
   * Начало текущего удержания токена, ISO: последний момент, когда баланс
   * вырос с нуля. Читатель его не знает — заполняет attachPendleHeldSince
   * по истории переводов; null = не найдено.
   */
  heldSince: string | null;
  raw: bigint;
  decimals: number;
  /** null = SY не ответил: в чем выражен курс, неизвестно. */
  assetAddress: string | null;
  assetSymbol: string | null;
  assetDecimals: number | null;
  assetCoingeckoId: string | null;
  /** Сырой курс оракула; null = оракул ревертнул (позиция есть, оценки нет). */
  rateRaw: bigint | null;
  impliedApyPercent: number | null;
  underlyingApyPercent: number | null;
}

export interface PendleChainStatus {
  chain: ChainId;
  /** false = не прочитано: значение НЕизвестно, а не «позиций нет». */
  ok: boolean;
  error?: string;
  positions: PendlePositionReading[];
}

type MulticallResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error; result?: undefined };

/** Узкий интерфейс клиента — читатель тестируется без сети. */
export interface PendleRpcClient {
  multicall(args: {
    contracts: readonly {
      address: Address;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- контракты гетерогенные: erc20 + оракул + SY
      abi: any;
      functionName: string;
      args: readonly unknown[];
    }[];
    allowFailure: true;
    batchSize?: number;
  }): Promise<readonly MulticallResult[]>;
}

export interface PendleReadOptions {
  clients?: Partial<Record<ChainId, PendleRpcClient>>;
  /** Справочник рынков по сетям; без него — из API. */
  markets?: Partial<Record<ChainId, PendleMarket[]>>;
  logCall?: typeof logApiCall;
}

/**
 * Курс оракула в человеческих единицах: сколько актива стоит ОДИН токен.
 * null, если чего-то не хватает — подставлять «примерно 1» нельзя.
 */
export function pendleRateToAsset(
  rateRaw: bigint | null,
  decimals: number,
  assetDecimals: number | null,
): number | null {
  if (rateRaw === null || assetDecimals === null || rateRaw < 0n) return null;
  const rate = (Number(rateRaw) / RATE_SCALE) * 10 ** (decimals - assetDecimals);
  return Number.isFinite(rate) ? rate : null;
}

const okBigint = (res: MulticallResult | undefined): bigint | null =>
  res?.status === "success" && typeof res.result === "bigint" ? res.result : null;

interface HeldToken {
  market: PendleMarket;
  tokenType: PendleTokenType;
  token: string;
  raw: bigint;
}

function tokensOf(market: PendleMarket): { tokenType: PendleTokenType; token: string }[] {
  return [
    { tokenType: "pt", token: market.pt },
    { tokenType: "yt", token: market.yt },
    { tokenType: "lp", token: market.address },
  ];
}

/** Позиции Pendle на одной сети. Никогда не бросает. */
export async function readChainPendle(
  client: PendleRpcClient,
  chain: ChainId,
  wallet: Address,
  markets: PendleMarket[],
  logCall: typeof logApiCall = logApiCall,
): Promise<PendleChainStatus> {
  if (markets.length === 0) return { chain, ok: true, positions: [] };

  try {
    // --- 1. Балансы по всем токенам всех рынков сети
    const candidates = markets.flatMap((market) =>
      tokensOf(market).map((t) => ({ market, ...t })),
    );
    const balances = await client.multicall({
      contracts: candidates.map((c) => ({
        address: c.token as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet] as const,
      })),
      allowFailure: true,
      batchSize: BALANCES_BATCH_BYTES,
    });
    void logCall("alchemy", `pendle:${chain}:balances`, { units: 1 });

    const held: HeldToken[] = [];
    balances.forEach((res, i) => {
      const raw = okBigint(res);
      // Упавший balanceOf — «неизвестно». Позицией его не считаем: токенов
      // сотни, и старые рынки иногда ревертят на чтении
      if (raw !== null && raw > 0n) held.push({ ...candidates[i], raw });
    });
    if (held.length === 0) return { chain, ok: true, positions: [] };

    // --- 2. Курс, decimals и актив только по ненулевым
    const sys = [...new Set(held.map((h) => h.market.sy))];
    const detailCalls = [
      ...held.flatMap((h) => [
        {
          address: PENDLE_ORACLE as Address,
          abi: pendleOracleAbi,
          functionName: RATE_FUNCTION[h.tokenType],
          args: [h.market.address as Address, PENDLE_TWAP_SECONDS] as const,
        },
        {
          address: h.token as Address,
          abi: erc20Abi,
          functionName: "decimals",
          args: [] as const,
        },
      ]),
      ...sys.map((sy) => ({
        address: sy as Address,
        abi: pendleSyAbi,
        functionName: "assetInfo",
        args: [] as const,
      })),
    ];
    const details = await client.multicall({
      contracts: detailCalls,
      allowFailure: true,
    });
    void logCall("alchemy", `pendle:${chain}:details`, { units: 1 });

    const assetBySy = new Map<string, { address: string; decimals: number }>();
    sys.forEach((sy, i) => {
      const res = details[held.length * 2 + i];
      if (res?.status !== "success" || !Array.isArray(res.result)) return;
      const [, address, decimals] = res.result as unknown as readonly [number, string, number];
      if (typeof address !== "string") return;
      assetBySy.set(sy, { address: address.toLowerCase(), decimals: Number(decimals) });
    });

    // --- 3. Символы активов: по ним ищется цена
    const assets = [...new Set([...assetBySy.values()].map((a) => a.address))].filter(
      (a) => a !== NATIVE_ASSET,
    );
    const symbols = new Map<string, string>([[NATIVE_ASSET, "ETH"]]);
    if (assets.length > 0) {
      const symbolResults = await client.multicall({
        contracts: assets.map((a) => ({
          address: a as Address,
          abi: erc20Abi,
          functionName: "symbol",
          args: [] as const,
        })),
        allowFailure: true,
      });
      void logCall("alchemy", `pendle:${chain}:symbols`, { units: 1 });
      symbolResults.forEach((res, i) => {
        if (res.status === "success" && typeof res.result === "string") {
          symbols.set(assets[i], res.result);
        }
      });
    }

    const positions: PendlePositionReading[] = [];
    for (const [i, h] of held.entries()) {
      const rateRaw = okBigint(details[i * 2]);
      const decRes = details[i * 2 + 1];
      // Без decimals количество не выразить. Это не «позиции нет», а
      // «прочитано не полностью» — сеть целиком помечается непрочитанной,
      // чтобы позиция не удалилась из кэша как закрытая
      if (decRes?.status !== "success" || typeof decRes.result !== "number") {
        return {
          chain,
          ok: false,
          error: `decimals() не прочитан: ${h.token}`,
          positions: [],
        };
      }
      const asset = assetBySy.get(h.market.sy) ?? null;
      const assetSymbol = asset ? (symbols.get(asset.address) ?? null) : null;
      positions.push({
        chain,
        tokenType: h.tokenType,
        token: h.token,
        market: h.market.address,
        marketName: h.market.name,
        expiry: h.market.expiry,
        heldSince: null,
        raw: h.raw,
        decimals: decRes.result,
        assetAddress: asset?.address ?? null,
        assetSymbol,
        assetDecimals: asset?.decimals ?? null,
        assetCoingeckoId: assetSymbol ? coingeckoIdForSymbol(assetSymbol) : null,
        rateRaw,
        impliedApyPercent: h.market.impliedApyPercent,
        underlyingApyPercent: h.market.underlyingApyPercent,
      });
    }

    return { chain, ok: true, positions };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logCall("alchemy", `pendle:${chain}:balances`, { units: 1, ok: false });
    console.warn(`[pendle] ${chain}: не прочитан: ${message}`);
    return { chain, ok: false, error: message, positions: [] };
  }
}

/** Позиции Pendle по всем сетям; отказ сети или API по сети изолирован. */
export async function readWalletPendle(
  wallet: Address,
  opts: PendleReadOptions = {},
): Promise<PendleChainStatus[]> {
  const clients = getChainClients() as unknown as Record<ChainId, PendleRpcClient>;
  const logCall = opts.logCall ?? logApiCall;
  return Promise.all(
    PENDLE_CHAINS.map(async (chain): Promise<PendleChainStatus> => {
      let markets: PendleMarket[];
      try {
        markets = opts.markets?.[chain] ?? (await getPendleMarkets(chain, { logCall }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[pendle] ${chain}: справочник рынков недоступен: ${message}`);
        return { chain, ok: false, error: `Pendle API: ${message}`, positions: [] };
      }
      const client = opts.clients?.[chain] ?? clients[chain];
      return readChainPendle(client, chain, wallet, markets, logCall);
    }),
  );
}

/** JSON-полезная нагрузка позиции Pendle в protocol_positions. */
export interface PendlePositionPayload {
  kind: "pendle";
  tokenType: PendleTokenType;
  token: string;
  market: string;
  marketName: string;
  expiry: string;
  /** Начало текущего удержания — начало шкалы до погашения; null = неизвестно. */
  heldSince: string | null;
  decimals: number;
  /** Сырое значение строкой — пересчет без потери точности. */
  raw: string;
  assetSymbol: string | null;
  assetCoingeckoId: string | null;
  /** Сколько актива стоит один токен на момент чтения; null = не оценен. */
  rateToAsset: number | null;
  impliedApyPercent: number | null;
  underlyingApyPercent: number | null;
}

/** Строка protocol_positions из показания — отдельно, чтобы тестировать. */
export function pendleRowOf(walletId: string, p: PendlePositionReading, nowIso: string) {
  return {
    wallet_id: walletId,
    protocol: PENDLE_SOURCE,
    chain: p.chain,
    external_id: p.token,
    quantity: formatUnits(p.raw, p.decimals),
    // Оценка — на сборке по свежей цене актива, как у Fluid
    value_usd: null,
    payload: {
      kind: "pendle",
      tokenType: p.tokenType,
      token: p.token,
      market: p.market,
      marketName: p.marketName,
      expiry: p.expiry,
      heldSince: p.heldSince,
      decimals: p.decimals,
      raw: p.raw.toString(),
      assetSymbol: p.assetSymbol,
      assetCoingeckoId: p.assetCoingeckoId,
      rateToAsset: pendleRateToAsset(p.rateRaw, p.decimals, p.assetDecimals),
      impliedApyPercent: p.impliedApyPercent,
      underlyingApyPercent: p.underlyingApyPercent,
    } satisfies PendlePositionPayload,
    updated_at: nowIso,
  };
}

/**
 * Запись позиций: ненулевые — upsert, исчезнувшие уходят в архив закрытых
 * и удаляются — только на сетях, которые ответили. Неоцененная позиция
 * записывается как есть: она существует, и удалить ее значило бы показать
 * закрытие.
 */
/**
 * Дата покупки для каждой прочитанной позиции.
 *
 * Перенос из прошлого чтения — первым делом: история переводов не меняется,
 * а поиск по ней стоит двух запросов на токен. Ищется только то, чего ещё
 * нет: новая позиция или та, у которой прошлый поиск не дал ответа.
 *
 * Перенос держится, пока позиция видна. Ушла в ноль — строка закрывается
 * (closures.ts), и повторный вход ищется заново как новое удержание.
 * Выход и вход между двумя обновлениями увидеть нельзя: тогда останется
 * старая дата. Цена ошибки — шкала, начатая раньше, а не неверная сумма.
 */
export async function attachPendleHeldSince(
  admin: SupabaseClient,
  walletId: string,
  wallet: string,
  statuses: PendleChainStatus[],
  find: typeof findHeldSince = findHeldSince,
): Promise<void> {
  const { data: existing, error } = await admin
    .from("protocol_positions")
    .select("chain, external_id, payload")
    .eq("wallet_id", walletId)
    .eq("protocol", PENDLE_SOURCE);
  if (error) throw new Error(`protocol_positions (pendle) read: ${error.message}`);

  const previous = new Map<string, string>();
  for (const row of existing ?? []) {
    const held = (row.payload as Partial<PendlePositionPayload> | null)?.heldSince;
    if (typeof held === "string") previous.set(`${row.chain}:${row.external_id}`, held);
  }

  await Promise.all(
    statuses
      .filter((s) => s.ok)
      .flatMap((s) => s.positions)
      .map(async (p) => {
        p.heldSince =
          previous.get(`${p.chain}:${p.token}`) ??
          (await find(p.chain, p.token, wallet));
      }),
  );
}

export async function persistPendlePositions(
  admin: SupabaseClient,
  userId: string,
  walletId: string,
  statuses: PendleChainStatus[],
): Promise<void> {
  const nowIso = new Date().toISOString();
  const upserts = statuses
    .filter((s) => s.ok)
    .flatMap((s) => s.positions.map((p) => pendleRowOf(walletId, p, nowIso)));

  if (upserts.length > 0) {
    const { error } = await admin
      .from("protocol_positions")
      .upsert(upserts, { onConflict: "wallet_id,protocol,chain,external_id" });
    if (error) throw new Error(`protocol_positions (pendle) upsert: ${error.message}`);
  }

  for (const status of statuses) {
    if (!status.ok) continue;
    await closeVanishedPositions(admin, {
      userId,
      walletId,
      protocol: PENDLE_SOURCE,
      chain: status.chain,
      aliveExternalIds: status.positions.map((p) => p.token),
      closedAt: nowIso,
    });
  }
}

/** Статус чтения Pendle по сетям — отдельный источник в chain_read_status. */
export async function persistPendleStatus(
  admin: SupabaseClient,
  walletId: string,
  statuses: PendleChainStatus[],
): Promise<void> {
  const checkedAt = new Date().toISOString();
  const { error } = await admin.from("chain_read_status").upsert(
    statuses.map((s) => ({
      wallet_id: walletId,
      source: PENDLE_SOURCE,
      chain: s.chain,
      ok: s.ok,
      error: s.error ?? null,
      checked_at: checkedAt,
    })),
    { onConflict: "wallet_id,source,chain" },
  );
  if (error) throw new Error(`chain_read_status (pendle) upsert: ${error.message}`);
}
