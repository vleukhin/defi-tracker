import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api/auth";
import { createTimer } from "@/lib/api/timing";
import { loadPortfolio } from "@/lib/portfolio/load";

/**
 * GET /api/zones — разрез портфеля по зонам стратегии Capital Growth
 * (docs/07-strategia-capital-growth.md).
 *
 * Только кэши, как и остальные экраны чтения: свежие данные приносит
 * POST /api/refresh.
 *
 * Инвариант, который здесь и проявляется: сумма зон равна «Активам» из
 * связки пяти чисел. Вычитать в зонах нечего — позиции входят целиком,
 * а собственные доли внутри них живут в категории «Стейблы».
 */
export async function GET() {
  const timer = createTimer();
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;
  timer.mark("auth");

  try {
    const portfolio = await loadPortfolio(supabase, user.id, {
      mark: timer.mark,
    });
    timer.mark("build");
    return NextResponse.json({
      zones: portfolio.zones,
      positions: portfolio.positions,
      positionsSummary: portfolio.positionsSummary,
      // Плоский список свободных балансов для карточки разметки: экран уже
      // грузит этот эндпоинт, отдельного запроса не появляется
      free: portfolio.rows.flatMap((r) => r.freeBalances),
      freeSummary: {
        ownUsd: portfolio.freeOwnUsd,
        borrowedUsd: portfolio.freeBorrowedUsd,
        unmarkedCount: portfolio.unmarkedFreeCount,
        dust: portfolio.freeDust,
        other: portfolio.freeOther,
      },
      // Ставки позиций сравниваются не с нулем, а со стоимостью заемных
      // стейблов: депозит держат, только пока он дороже займа (docs/07 §3)
      stableBorrow: portfolio.stableBorrow,
      // Для сверки на экране: сумма зон обязана совпасть с Активами
      assetsUsd: portfolio.overview.assetsUsd,
      stableCategoryUsd:
        portfolio.rows.find((r) => r.category === "stable")?.amountUsd ?? 0,
    }, { headers: timer.headers() });
  } catch (err) {
    return apiError(
      500,
      err instanceof Error ? err.message : "Не удалось собрать зоны",
    );
  }
}
