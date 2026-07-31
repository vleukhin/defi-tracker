import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api/auth";
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
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  try {
    const portfolio = await loadPortfolio(supabase, user.id);
    return NextResponse.json({
      zones: portfolio.zones,
      positions: portfolio.positions,
      positionsSummary: portfolio.positionsSummary,
      // Для сверки на экране: сумма зон обязана совпасть с Активами
      assetsUsd: portfolio.overview.assetsUsd,
      stableCategoryUsd:
        portfolio.rows.find((r) => r.category === "stable")?.amountUsd ?? 0,
    });
  } catch (err) {
    return apiError(
      500,
      err instanceof Error ? err.message : "Не удалось собрать зоны",
    );
  }
}
