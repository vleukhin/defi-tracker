import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { COINGECKO_PLATFORMS, type ChainId } from "@/lib/chains/config";
import {
  fetchNativePrices,
  fetchTokenPrices,
  type CoingeckoClientOptions,
} from "./coingecko";

/**
 * Общий серверный кэш цен (ТЗ Часть 4 §4): таблица price_cache, TTL 5 мин.
 * Свежие цены отдаются из кэша; внешний поход — только по истекшим.
 * При отказе CoinGecko возвращаются устаревшие цены с их fetched_at
 * (caller показывает бейдж свежести). Цена актива без coingecko_id
 * НИКОГДА не запрашивается (защита от скам-токенов, ТЗ S1.4).
 */

export const PRICE_TTL_MS = 5 * 60_000;

export interface AssetForPricing {
  id: string;
  chain: ChainId;
  contract_address: string | null;
  kind: string;
  coingecko_id: string | null;
}

export interface AssetPrice {
  assetId: string;
  priceUsd: number;
  fetchedAt: string;
  /** true = TTL истек, но свежую цену получить не удалось. */
  stale: boolean;
}

export interface GetPricesOptions {
  admin?: SupabaseClient;
  /** false = только чтение кэша (дашборд); true = дотянуть истекшие (refresh). */
  fetchIfExpired?: boolean;
  nowMs?: number;
  cg?: CoingeckoClientOptions;
}

interface CacheRow {
  asset_id: string;
  price_usd: number;
  fetched_at: string;
}

export async function getPrices(
  assets: AssetForPricing[],
  opts: GetPricesOptions = {},
): Promise<Map<string, AssetPrice>> {
  const admin = opts.admin ?? createAdminClient();
  const nowMs = opts.nowMs ?? Date.now();
  const result = new Map<string, AssetPrice>();
  if (assets.length === 0) return result;

  const ids = assets.map((a) => a.id);
  const { data: cached, error } = await admin
    .from("price_cache")
    .select("asset_id, price_usd, fetched_at")
    .in("asset_id", ids);
  if (error) throw new Error(`price_cache read: ${error.message}`);

  const cacheByAsset = new Map<string, CacheRow>(
    ((cached ?? []) as CacheRow[]).map((r) => [r.asset_id, r]),
  );

  const expired: AssetForPricing[] = [];
  for (const asset of assets) {
    const row = cacheByAsset.get(asset.id);
    if (row && nowMs - Date.parse(row.fetched_at) < PRICE_TTL_MS) {
      result.set(asset.id, {
        assetId: asset.id,
        priceUsd: Number(row.price_usd),
        fetchedAt: row.fetched_at,
        stale: false,
      });
    } else {
      expired.push(asset);
    }
  }

  if (!opts.fetchIfExpired || expired.length === 0) {
    markStaleFallback(expired, cacheByAsset, result);
    return result;
  }

  // Дотягиваем только активы с листингом CoinGecko
  const fetchable = expired.filter((a) => a.coingecko_id !== null);
  const fetchedAt = new Date(nowMs).toISOString();
  const freshRows: { asset_id: string; price_usd: number; source: string; fetched_at: string }[] = [];
  const stillMissing = new Set(expired.map((a) => a.id));

  // Нативные монеты — /simple/price по coingecko id
  const natives = fetchable.filter((a) => a.kind === "native");
  if (natives.length > 0) {
    try {
      const prices = await fetchNativePrices(
        natives.map((a) => a.coingecko_id!),
        opts.cg,
      );
      for (const a of natives) {
        const price = prices[a.coingecko_id!];
        if (typeof price === "number") {
          freshRows.push({ asset_id: a.id, price_usd: price, source: "coingecko", fetched_at: fetchedAt });
          result.set(a.id, { assetId: a.id, priceUsd: price, fetchedAt, stale: false });
          stillMissing.delete(a.id);
        }
      }
    } catch (err) {
      console.warn("[prices] /simple/price недоступен:", err);
    }
  }

  // ERC-20 — /simple/token_price/{platform}, батчами по сетям
  const byChain = new Map<ChainId, AssetForPricing[]>();
  for (const a of fetchable) {
    if (a.kind !== "erc20" || !a.contract_address) continue;
    const list = byChain.get(a.chain) ?? [];
    list.push(a);
    byChain.set(a.chain, list);
  }
  for (const [chain, chainAssets] of byChain) {
    try {
      const prices = await fetchTokenPrices(
        COINGECKO_PLATFORMS[chain],
        chainAssets.map((a) => a.contract_address!),
        opts.cg,
      );
      for (const a of chainAssets) {
        const price = prices[a.contract_address!.toLowerCase()];
        if (typeof price === "number") {
          freshRows.push({ asset_id: a.id, price_usd: price, source: "coingecko", fetched_at: fetchedAt });
          result.set(a.id, { assetId: a.id, priceUsd: price, fetchedAt, stale: false });
          stillMissing.delete(a.id);
        }
      }
    } catch (err) {
      // Грациозная деградация: сеть не оценена — ниже подставим stale-кэш
      console.warn(`[prices] token_price(${chain}) недоступен:`, err);
    }
  }

  if (freshRows.length > 0) {
    const { error: upsertError } = await admin
      .from("price_cache")
      .upsert(freshRows, { onConflict: "asset_id" });
    if (upsertError) {
      console.warn(`[prices] price_cache upsert: ${upsertError.message}`);
    }
  }

  // Что не удалось обновить — отдаем устаревшее значение из кэша, если есть
  const staleAssets = expired.filter((a) => stillMissing.has(a.id));
  markStaleFallback(staleAssets, cacheByAsset, result);
  return result;
}

function markStaleFallback(
  assets: AssetForPricing[],
  cacheByAsset: Map<string, CacheRow>,
  result: Map<string, AssetPrice>,
): void {
  for (const a of assets) {
    const row = cacheByAsset.get(a.id);
    if (row) {
      result.set(a.id, {
        assetId: a.id,
        priceUsd: Number(row.price_usd),
        fetchedAt: row.fetched_at,
        stale: true,
      });
    }
    // Нет ни свежей, ни устаревшей цены — актива нет в результате:
    // движок аллокации отправит его в «Нераспознанные».
  }
}
