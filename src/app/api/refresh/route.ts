import { NextResponse, type NextRequest } from "next/server";
import type { Address } from "viem";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  readWalletAaveCollateral,
  persistAaveCollateral,
  persistChainStatus,
} from "@/lib/chains/aave";
import {
  persistAaveDebt,
  persistAaveHealth,
  persistDebtStatus,
  readWalletAaveDebt,
} from "@/lib/chains/aave-debt";
import { CATEGORY_COINGECKO_IDS, getCoinPrices } from "@/lib/prices/coins";

/**
 * POST /api/refresh[?walletId=...] — on-demand обновление (ТЗ Часть 4 §6.1):
 * 1) debounce 60 с на кошелек (last_refreshed_at; внутри окна — debounced: true);
 * 2) один multicall на сеть: aToken.balanceOf по покрываемым резервам Aave v3;
 * 3) второй multicall на сеть (Фаза 4): Pool.getUserAccountData (Долг и HF,
 *    оракул Aave) + vToken.balanceOf по всем резервам (разбивка долга);
 * 4) цены категорий, залоговых и долговых токенов — coin_prices, внешний
 *    поход только по истекшему TTL;
 * 5) запись в protocol_positions + aave_account_health + chain_read_status.
 * Без walletId обновляются все кошельки пользователя.
 *
 * Свободные ERC-20 балансы кошелька здесь НЕ читаются: по ТЗ 02 §2а количества
 * берутся из залога и ручных записей. Модуль chains/reader.ts сохранен для
 * Фазы 5 (GMX GM-токены, Uniswap LP), но в пути портфеля не участвует —
 * это экономит по одному multicall на сеть за каждое обновление.
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
        reservesRead: number;
        reservesFailed: number;
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

  let query = supabase.from("wallets").select("id, address, last_refreshed_at");
  if (walletIdParam) query = query.eq("id", walletIdParam);
  const { data: wallets, error: walletsError } = await query;
  if (walletsError) return apiError(500, walletsError.message);
  if (walletIdParam && (!wallets || wallets.length === 0)) {
    return apiError(404, "Кошелек не найден");
  }

  const admin = createAdminClient();
  const nowMs = Date.now();
  const results: WalletRefreshResult[] = [];
  const collateralIds = new Set<string>();

  for (const wallet of wallets ?? []) {
    const lastMs = wallet.last_refreshed_at
      ? Date.parse(wallet.last_refreshed_at)
      : null;
    if (lastMs !== null && nowMs - lastMs < DEBOUNCE_MS) {
      // Внутри окна дебаунса — отдаем кэшированное состояние (GET /api/portfolio)
      results.push({ walletId: wallet.id, debounced: true, chains: null });
      continue;
    }

    try {
      const statuses = await readWalletAaveCollateral(wallet.address as Address);
      await persistAaveCollateral(admin, wallet.id, statuses);
      await persistChainStatus(admin, wallet.id, statuses);

      // Долг и HF (Фаза 4) — отдельный контур: его отказ не отменяет залог
      try {
        const debtStatuses = await readWalletAaveDebt(wallet.address as Address);
        await persistAaveHealth(admin, wallet.id, debtStatuses);
        await persistAaveDebt(admin, wallet.id, debtStatuses);
        await persistDebtStatus(admin, wallet.id, debtStatuses);
        for (const s of debtStatuses) {
          for (const d of s.debts) {
            if (d.raw > 0n && d.coingeckoId) collateralIds.add(d.coingeckoId);
          }
        }
      } catch (err) {
        console.warn(`[refresh] долг кошелька ${wallet.id} не прочитан:`, err);
      }

      await supabase
        .from("wallets")
        .update({ last_refreshed_at: new Date().toISOString() })
        .eq("id", wallet.id);

      for (const s of statuses) {
        for (const c of s.collateral) {
          if (c.raw > 0n) collateralIds.add(c.coingeckoId);
        }
      }

      results.push({
        walletId: wallet.id,
        debounced: false,
        chains: statuses.map((s) => ({
          chain: s.chain,
          ok: s.ok,
          ...(s.error ? { error: s.error } : {}),
          reservesRead: s.collateral.length,
          reservesFailed: s.failedReserves.length,
        })),
      });
    } catch (err) {
      // Один кошелек не обновился — остальные продолжаем
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[refresh] кошелек ${wallet.id}: ${message}`);
      results.push({ walletId: wallet.id, debounced: false, chains: [] });
    }
  }

  // Цены: категории всегда + токены, которые реально лежат в залоге
  // или заняты (оценка разбивки долга на экране «Долг»)
  const priceIds = [
    CATEGORY_COINGECKO_IDS.btc,
    CATEGORY_COINGECKO_IDS.eth,
    ...collateralIds,
  ];
  let priceSummary = { requested: priceIds.length, priced: 0, stale: 0 };
  try {
    const prices = await getCoinPrices(priceIds, {
      admin,
      fetchIfExpired: true,
    });
    let stale = 0;
    for (const p of prices.values()) if (p.stale) stale += 1;
    priceSummary = { requested: priceIds.length, priced: prices.size, stale };
  } catch (err) {
    console.warn("[refresh] цены не обновлены:", err);
  }

  return NextResponse.json({
    results,
    prices: priceSummary,
    refreshedAt: new Date().toISOString(),
  });
}
