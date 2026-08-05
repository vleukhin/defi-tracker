import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api/auth";
import { createTimer } from "@/lib/api/timing";
import { loadPortfolio } from "@/lib/portfolio/load";

/**
 * GET /api/portfolio — компактный портфель из трех категорий (ТЗ 02 §2а).
 *
 * Только кэши (protocol_positions + coin_prices + ручные записи): ни RPC,
 * ни CoinGecko — дашборд обязан рисоваться быстро. Обновление данных —
 * отдельный POST /api/refresh. RLS изолирует данные; сессия проверяется здесь.
 */
export async function GET() {
  // Фазы ответа видны в DevTools → Network → Timing (см. lib/api/timing)
  const timer = createTimer();
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;
  timer.mark("auth");

  try {
    const portfolio = await loadPortfolio(supabase, user.id, {
      fetchIfExpired: false,
      mark: timer.mark,
    });
    timer.mark("build");

    return NextResponse.json({
      totalUsd: portfolio.totalUsd,
      // Связка пяти чисел (S4.2): Активы · Долг · Чистая · Внесено · Прибыль
      overview: portfolio.overview,
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
      // Свободные средства читаются отдельным контуром, поэтому и статус
      // сетей у них свой: залог мог прочитаться, а балансы — нет
      freeChains: portfolio.freeChains.map((c) => ({
        chain: c.chain,
        ok: c.ok,
        ...(c.error ? { error: c.error } : {}),
        checkedAt: c.checked_at,
      })),
      freeSummary: {
        ownUsd: portfolio.freeOwnUsd,
        borrowedUsd: portfolio.freeBorrowedUsd,
        unmarkedCount: portfolio.unmarkedFreeCount,
        dust: portfolio.freeDust,
        other: portfolio.freeOther,
      },
      wallets: portfolio.wallets.map((w) => ({
        id: w.id,
        address: w.address,
        label: w.label,
        lastRefreshedAt: w.last_refreshed_at,
      })),
    }, { headers: timer.headers() });
  } catch (err) {
    return apiError(
      500,
      err instanceof Error ? err.message : "Не удалось собрать портфель",
    );
  }
}
