import "server-only";
import { logApiCall } from "@/lib/metrics";

/**
 * Публичное API GMX v2 (arbitrum-api.gmxinfra.io) — ТЗ Часть 4 §3.4.
 *
 * Цены GM-токенов НЕ берутся у CoinGecko: там их нет, а если бы и были —
 * стоимость GM определяется составом пула и незакрытым PnL трейдеров, то есть
 * оракулом самого GMX. Здесь мы получаем подписанные оракульные цены базовых
 * токенов, которые дальше скармливаем Reader.getMarketTokenPrice.
 *
 * Фикс-поинт GMX: цена приходит масштабированной на 10^(30 − decimals токена),
 * а не на 1e30. Проверено на живых данных: ETH (18 знаков) 1885767504879115 →
 * $1885,77; USDC (6 знаков) 999757390000000000000000 → $0,99976. Делить на
 * 1e30 без учета decimals — типичная ошибка, дающая расхождение на порядки.
 */

const GMX_API_BASE = "https://arbitrum-api.gmxinfra.io";

/** Цены оракула отдаются парой: min/max — спред, а не одна точка. */
export interface GmxTokenPrice {
  min: bigint;
  max: bigint;
}

export interface GmxMarket {
  name: string;
  marketToken: string;
  indexToken: string;
  longToken: string;
  shortToken: string;
}

export interface GmxApiData {
  /** decimals по адресу токена в нижнем регистре. */
  decimals: Map<string, number>;
  /** Сырые оракульные цены по адресу токена в нижнем регистре. */
  prices: Map<string, GmxTokenPrice>;
  /** Рынки по адресу GM-токена в нижнем регистре. */
  markets: Map<string, GmxMarket>;
}

export interface GmxApiOptions {
  fetchImpl?: typeof fetch;
  logCall?: typeof logApiCall;
  nowMs?: number;
}

/** Сырую цену GMX в доллары: масштаб зависит от decimals токена. */
export function gmxPriceToUsd(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** (30 - decimals);
}

/** Средняя цена оракула — между min и max; спред у GMX узкий. */
export function gmxMidPriceUsd(price: GmxTokenPrice, decimals: number): number {
  return (gmxPriceToUsd(price.min, decimals) + gmxPriceToUsd(price.max, decimals)) / 2;
}

interface TokensResponse {
  tokens: { symbol: string; address: string; decimals: number }[];
}
interface TickerEntry {
  tokenAddress: string;
  tokenSymbol: string;
  minPrice: string;
  maxPrice: string;
}
interface MarketsResponse {
  markets: GmxMarket[];
}

/**
 * Кэш на процесс: три эндпоинта на обновление — многовато, если кошельков
 * несколько. TTL общий с ценами (5 минут), потому что дольше держать
 * оракульные цены нельзя.
 */
const TTL_MS = 5 * 60 * 1000;
let cache: { data: GmxApiData; fetchedAtMs: number } | null = null;

/** Только для тестов: сбрасывает процессный кэш. */
export function resetGmxApiCache(): void {
  cache = null;
}

/**
 * Справочник токенов, цены и список рынков — три GET'а.
 * Бросает при недоступности: вызывающий обязан трактовать это как
 * «GM-позиции неизвестны», а не как «GM-позиций нет».
 */
export async function getGmxApiData(
  opts: GmxApiOptions = {},
): Promise<GmxApiData> {
  const nowMs = opts.nowMs ?? Date.now();
  if (cache && nowMs - cache.fetchedAtMs < TTL_MS) return cache.data;

  const doFetch = opts.fetchImpl ?? fetch;
  const logCall = opts.logCall ?? logApiCall;

  const get = async <T>(path: string): Promise<T> => {
    const res = await doFetch(`${GMX_API_BASE}${path}`);
    if (!res.ok) throw new Error(`GMX ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  };

  try {
    const [tokens, tickers, markets] = await Promise.all([
      get<TokensResponse>("/tokens"),
      get<TickerEntry[]>("/prices/tickers"),
      get<MarketsResponse>("/markets/info"),
    ]);
    void logCall("gmx", "tokens+tickers+markets", { units: 3 });

    const data: GmxApiData = {
      decimals: new Map(
        tokens.tokens.map((t) => [t.address.toLowerCase(), t.decimals]),
      ),
      prices: new Map(
        tickers.map((t) => [
          t.tokenAddress.toLowerCase(),
          { min: BigInt(t.minPrice), max: BigInt(t.maxPrice) },
        ]),
      ),
      markets: new Map(
        markets.markets.map((m) => [m.marketToken.toLowerCase(), m]),
      ),
    };

    cache = { data, fetchedAtMs: nowMs };
    return data;
  } catch (err) {
    void logCall("gmx", "tokens+tickers+markets", { units: 3, ok: false });
    throw err instanceof Error ? err : new Error(String(err));
  }
}
