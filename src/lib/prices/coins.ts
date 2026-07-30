import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchNativePrices, type CoingeckoClientOptions } from "./coingecko";
import { PRICE_TTL_MS } from "./index";

/**
 * Кэш цен по coingecko id (таблица coin_prices, TTL 5 мин).
 *
 * Отличие от price_cache: там ключ — assets.id (справочник ERC-20 для Фазы 5),
 * здесь — coingecko id. Модели портфеля нужны именно id: цены категорий
 * (bitcoin / ethereum) и цены залоговых токенов Aave (wrapped-steth и т.п.),
 * которых в справочнике assets нет.
 *
 * При отказе CoinGecko отдается последняя известная цена с пометкой stale —
 * категория никогда не оценивается в 0 из-за недоступности прайсера.
 */

/** Цена стейблкоинов фиксирована: пользователь вносит уже вложенные доллары. */
export const STABLE_PRICE_USD = 1;

/** Цены категорий портфеля. */
export const CATEGORY_COINGECKO_IDS = {
  btc: "bitcoin",
  eth: "ethereum",
} as const;

export interface CoinPrice {
  coingeckoId: string;
  priceUsd: number;
  fetchedAt: string;
  /** true = TTL истек, свежую цену получить не удалось. */
  stale: boolean;
}

export interface GetCoinPricesOptions {
  admin?: SupabaseClient;
  /** false = только кэш (дашборд); true = дотянуть истекшие (refresh). */
  fetchIfExpired?: boolean;
  nowMs?: number;
  cg?: CoingeckoClientOptions;
}

interface CoinPriceRow {
  coingecko_id: string;
  price_usd: number;
  fetched_at: string;
}

export async function getCoinPrices(
  ids: string[],
  opts: GetCoinPricesOptions = {},
): Promise<Map<string, CoinPrice>> {
  const result = new Map<string, CoinPrice>();
  const wanted = [...new Set(ids)].filter((id) => id.length > 0);
  if (wanted.length === 0) return result;

  const admin = opts.admin ?? createAdminClient();
  const nowMs = opts.nowMs ?? Date.now();

  const { data, error } = await admin
    .from("coin_prices")
    .select("coingecko_id, price_usd, fetched_at")
    .in("coingecko_id", wanted);
  if (error) throw new Error(`coin_prices read: ${error.message}`);

  const cached = new Map<string, CoinPriceRow>(
    ((data ?? []) as CoinPriceRow[]).map((r) => [r.coingecko_id, r]),
  );

  const expired: string[] = [];
  for (const id of wanted) {
    const row = cached.get(id);
    if (row && nowMs - Date.parse(row.fetched_at) < PRICE_TTL_MS) {
      result.set(id, {
        coingeckoId: id,
        priceUsd: Number(row.price_usd),
        fetchedAt: row.fetched_at,
        stale: false,
      });
    } else {
      expired.push(id);
    }
  }

  if (!opts.fetchIfExpired || expired.length === 0) {
    fallbackToStale(expired, cached, result);
    return result;
  }

  const fetchedAt = new Date(nowMs).toISOString();
  let fresh: Record<string, number> = {};
  try {
    // Один /simple/price на все id — дешево по квоте
    fresh = await fetchNativePrices(expired, opts.cg);
  } catch (err) {
    console.warn("[coin-prices] /simple/price недоступен:", err);
  }

  const rows: CoinPriceRow[] = [];
  const stillMissing: string[] = [];
  for (const id of expired) {
    const price = fresh[id];
    if (typeof price === "number") {
      rows.push({ coingecko_id: id, price_usd: price, fetched_at: fetchedAt });
      result.set(id, {
        coingeckoId: id,
        priceUsd: price,
        fetchedAt,
        stale: false,
      });
    } else {
      // id не вернул цену: либо прайсер недоступен, либо id неверен.
      // Второе — ошибка конфигурации, поэтому логируем громко.
      console.warn(`[coin-prices] нет цены для id "${id}"`);
      stillMissing.push(id);
    }
  }

  if (rows.length > 0) {
    const { error: upsertError } = await admin
      .from("coin_prices")
      .upsert(rows, { onConflict: "coingecko_id" });
    if (upsertError) {
      console.warn(`[coin-prices] upsert: ${upsertError.message}`);
    }
  }

  fallbackToStale(stillMissing, cached, result);
  return result;
}

function fallbackToStale(
  ids: string[],
  cached: Map<string, CoinPriceRow>,
  result: Map<string, CoinPrice>,
): void {
  for (const id of ids) {
    const row = cached.get(id);
    if (row) {
      result.set(id, {
        coingeckoId: id,
        priceUsd: Number(row.price_usd),
        fetchedAt: row.fetched_at,
        stale: true,
      });
    }
    // Ни свежей, ни устаревшей цены — id отсутствует в результате.
    // Движок портфеля пометит такой залог как «без цены», а не как 0.
  }
}
