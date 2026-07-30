import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api/auth";
import { PRICE_TTL_MS } from "@/lib/prices";
import {
  computeAllocation,
  type BucketInfo,
  type HoldingInput,
  type PriceEntry,
} from "@/lib/portfolio/allocation";

/**
 * GET /api/portfolio — агрегированное состояние для дашборда (S1.5–S1.7).
 * Только чтение кэшей (balances_cache + price_cache) — быстрый ответ,
 * никаких внешних вызовов; обновление данных — POST /api/refresh.
 * RLS изолирует данные; сессия дополнительно проверяется здесь.
 */

interface BalanceRow {
  wallet_id: string;
  raw_amount: string; // ::text — точность uint256 не теряется в JSON
  updated_at: string;
  assets: {
    id: string;
    chain: string;
    contract_address: string | null;
    symbol: string;
    decimals: number;
    coingecko_id: string | null;
    kind: string;
  } | null;
}

export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const [walletsRes, balancesRes, bucketsRes, mapRes, targetsRes] =
    await Promise.all([
      supabase
        .from("wallets")
        .select("id, address, label, last_refreshed_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("balances_cache")
        .select(
          "wallet_id, raw_amount::text, updated_at, assets(id, chain, contract_address, symbol, decimals, coingecko_id, kind)",
        ),
      supabase.from("buckets").select("id, user_id, name"),
      supabase.from("asset_bucket_map").select("asset_id, bucket_id, user_id"),
      supabase.from("target_allocations").select("bucket_id, target_pct"),
    ]);

  for (const res of [walletsRes, balancesRes, bucketsRes, mapRes, targetsRes]) {
    if (res.error) return apiError(500, res.error.message);
  }

  const wallets = walletsRes.data ?? [];
  const walletById = new Map(wallets.map((w) => [w.id, w]));
  const balanceRows = (balancesRes.data ?? []) as unknown as BalanceRow[];

  const holdings: HoldingInput[] = [];
  for (const row of balanceRows) {
    const asset = row.assets;
    const wallet = walletById.get(row.wallet_id);
    if (!asset || !wallet) continue;
    holdings.push({
      walletId: row.wallet_id,
      walletLabel: wallet.label,
      chain: asset.chain,
      assetId: asset.id,
      symbol: asset.symbol,
      decimals: asset.decimals,
      raw: BigInt(row.raw_amount),
      coingeckoId: asset.coingecko_id,
      balanceUpdatedAt: row.updated_at,
    });
  }

  // Цены — из общего кэша (читаем обычным клиентом: select разрешен RLS)
  const assetIds = [...new Set(holdings.map((h) => h.assetId))];
  const prices = new Map<string, PriceEntry>();
  if (assetIds.length > 0) {
    const { data: priceRows, error: priceError } = await supabase
      .from("price_cache")
      .select("asset_id, price_usd, fetched_at")
      .in("asset_id", assetIds);
    if (priceError) return apiError(500, priceError.message);
    const nowMs = Date.now();
    for (const p of priceRows ?? []) {
      prices.set(p.asset_id, {
        priceUsd: Number(p.price_usd),
        fetchedAt: p.fetched_at,
        stale: nowMs - Date.parse(p.fetched_at) >= PRICE_TTL_MS,
      });
    }
  }

  const buckets: BucketInfo[] = (bucketsRes.data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    builtin: b.user_id === null,
  }));

  const allocation = computeAllocation({
    holdings,
    prices,
    buckets,
    bucketMap: (mapRes.data ?? []).map((m) => ({
      assetId: m.asset_id,
      bucketId: m.bucket_id,
      userId: m.user_id,
    })),
    targets: (targetsRes.data ?? []).map((t) => ({
      bucketId: t.bucket_id,
      targetPct: Number(t.target_pct),
    })),
  });

  return NextResponse.json({
    ...allocation,
    wallets: wallets.map((w) => ({
      id: w.id,
      address: w.address,
      label: w.label,
      lastRefreshedAt: w.last_refreshed_at,
    })),
  });
}
