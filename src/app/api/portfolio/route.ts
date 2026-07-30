import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api/auth";
import { loadPortfolio } from "@/lib/portfolio/load";

/**
 * GET /api/portfolio — компактный портфель из трех категорий (ТЗ 02 §2а).
 *
 * Только кэши (protocol_positions + coin_prices + ручные записи): ни RPC,
 * ни CoinGecko — дашборд обязан рисоваться быстро. Обновление данных —
 * отдельный POST /api/refresh. RLS изолирует данные; сессия проверяется здесь.
 */
export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  try {
    const portfolio = await loadPortfolio(supabase, user.id, {
      fetchIfExpired: false,
    });

    return NextResponse.json({
      totalUsd: portfolio.totalUsd,
      rows: portfolio.rows,
      targetSumPct: portfolio.targetSumPct,
      freshness: {
        oldestPriceAt: portfolio.oldestPriceAt,
        oldestCollateralAt: portfolio.oldestCollateralAt,
        anyPriceStale: portfolio.anyPriceStale,
      },
      chains: portfolio.chains.map((c) => ({
        chain: c.chain,
        ok: c.ok,
        ...(c.error ? { error: c.error } : {}),
        checkedAt: c.checked_at,
      })),
      wallets: portfolio.wallets.map((w) => ({
        id: w.id,
        address: w.address,
        label: w.label,
        lastRefreshedAt: w.last_refreshed_at,
      })),
    });
  } catch (err) {
    return apiError(
      500,
      err instanceof Error ? err.message : "Не удалось собрать портфель",
    );
  }
}
