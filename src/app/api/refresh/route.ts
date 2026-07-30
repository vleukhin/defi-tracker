import { NextResponse, type NextRequest } from "next/server";
import type { Address } from "viem";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { readWalletBalances, persistBalances } from "@/lib/chains/reader";
import { getPrices, type AssetForPricing } from "@/lib/prices";

/**
 * POST /api/refresh[?walletId=...] — on-demand обновление (ТЗ Часть 4 §6.1):
 * 1) debounce 60 с на кошелек (last_refreshed_at; внутри окна — debounced: true);
 * 2) один multicall на сеть: нативный + ERC-20 по allowlist;
 * 3) цены из price_cache, внешний поход только по истекшему TTL;
 * 4) запись в balances_cache; ответ — статус по сетям.
 * Без walletId обновляются все кошельки пользователя.
 */

export const DEBOUNCE_MS = 60_000;

interface WalletRefreshResult {
  walletId: string;
  debounced: boolean;
  /** null у debounced-кошельков. */
  chains:
    | {
        chain: string;
        ok: boolean;
        error?: string;
        tokensRead: number;
        tokensFailed: number;
      }[]
    | null;
}

export async function POST(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const walletIdParam = request.nextUrl.searchParams.get("walletId");
  if (walletIdParam && !z.guid().safeParse(walletIdParam).success) {
    return apiError(400, "Невалидный walletId");
  }

  let query = supabase
    .from("wallets")
    .select("id, address, last_refreshed_at");
  if (walletIdParam) query = query.eq("id", walletIdParam);
  const { data: wallets, error: walletsError } = await query;
  if (walletsError) return apiError(500, walletsError.message);
  if (walletIdParam && (!wallets || wallets.length === 0)) {
    return apiError(404, "Кошелек не найден");
  }

  const admin = createAdminClient();
  const nowMs = Date.now();
  const results: WalletRefreshResult[] = [];

  for (const wallet of wallets ?? []) {
    const lastMs = wallet.last_refreshed_at
      ? Date.parse(wallet.last_refreshed_at)
      : null;
    if (lastMs !== null && nowMs - lastMs < DEBOUNCE_MS) {
      // Внутри окна дебаунса — отдаем кэшированное состояние (GET /api/portfolio)
      results.push({ walletId: wallet.id, debounced: true, chains: null });
      continue;
    }

    const statuses = await readWalletBalances(wallet.address as Address);
    await persistBalances(admin, wallet.id, statuses);
    await supabase
      .from("wallets")
      .update({ last_refreshed_at: new Date().toISOString() })
      .eq("id", wallet.id);

    results.push({
      walletId: wallet.id,
      debounced: false,
      chains: statuses.map((s) => ({
        chain: s.chain,
        ok: s.ok,
        ...(s.error ? { error: s.error } : {}),
        tokensRead: s.balances.length,
        tokensFailed: s.failedTokens.length,
      })),
    });
  }

  // Обновление цен по активам, которые пользователь реально держит
  const walletIds = (wallets ?? []).map((w) => w.id);
  let priceSummary = { requested: 0, priced: 0, stale: 0 };
  if (walletIds.length > 0) {
    const { data: held, error: heldError } = await supabase
      .from("balances_cache")
      .select("asset_id")
      .in("wallet_id", walletIds);
    if (heldError) return apiError(500, heldError.message);

    const assetIds = [...new Set((held ?? []).map((r) => r.asset_id))];
    if (assetIds.length > 0) {
      const { data: assets, error: assetsError } = await admin
        .from("assets")
        .select("id, chain, contract_address, kind, coingecko_id")
        .in("id", assetIds);
      if (assetsError) return apiError(500, assetsError.message);

      const prices = await getPrices((assets ?? []) as AssetForPricing[], {
        admin,
        fetchIfExpired: true,
      });
      let stale = 0;
      for (const p of prices.values()) if (p.stale) stale += 1;
      priceSummary = {
        requested: assetIds.length,
        priced: prices.size,
        stale,
      };
    }
  }

  return NextResponse.json({
    results,
    prices: priceSummary,
    refreshedAt: new Date().toISOString(),
  });
}
