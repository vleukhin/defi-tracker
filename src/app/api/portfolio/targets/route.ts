import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import {
  PORTFOLIO_CATEGORIES,
  validateTargets,
  type PortfolioCategory,
} from "@/lib/portfolio/portfolio";

/**
 * Целевые проценты по трем категориям (S1.6).
 * PUT заменяет набор целиком; сумма ≠ 100 — предупреждение, НЕ блокировка.
 */

const putSchema = z.object({
  targets: z
    .array(
      z.object({
        category: z.enum(PORTFOLIO_CATEGORIES),
        targetPct: z.number().min(0).max(100),
      }),
    )
    .max(PORTFOLIO_CATEGORIES.length),
});

export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { data, error } = await supabase
    .from("portfolio_targets")
    .select("category, target_pct");
  if (error) return apiError(500, error.message);

  const targets = (data ?? []).map((r) => ({
    category: r.category as PortfolioCategory,
    targetPct: Number(r.target_pct),
  }));
  const { sumPct, warning } = validateTargets(targets);
  return NextResponse.json({ targets, sumPct, warning });
}

export async function PUT(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Невалидный JSON");
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Невалидные данные", {
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  const targets = parsed.data.targets;
  const seen = new Set<string>();
  for (const t of targets) {
    if (seen.has(t.category)) {
      return apiError(400, `Категория ${t.category} указана дважды`);
    }
    seen.add(t.category);
  }

  // Замена набора: сначала убираем снятые цели, затем upsert заданных
  const keep = targets.map((t) => t.category);
  const toDelete = PORTFOLIO_CATEGORIES.filter((c) => !keep.includes(c));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("portfolio_targets")
      .delete()
      .in("category", toDelete);
    if (error) return apiError(500, error.message);
  }

  if (targets.length > 0) {
    const { error } = await supabase.from("portfolio_targets").upsert(
      targets.map((t) => ({
        user_id: user.id,
        category: t.category,
        target_pct: t.targetPct,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "user_id,category" },
    );
    if (error) return apiError(500, error.message);
  }

  const { sumPct, warning } = validateTargets(targets);
  return NextResponse.json({ targets, sumPct, warning });
}
