import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import { validateTargets } from "@/lib/portfolio/allocation";

/**
 * GET /api/targets — целевые проценты по корзинам.
 * PUT /api/targets — полная замена набора целей (S1.6):
 *   0–100 на корзину; сумма != 100 — предупреждение, НЕ блокировка.
 */

const putSchema = z.object({
  targets: z.array(
    z.object({
      bucketId: z.guid(),
      targetPct: z.number().min(0).max(100),
    }),
  ),
});

export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { data, error } = await supabase
    .from("target_allocations")
    .select("bucket_id, target_pct");
  if (error) return apiError(500, error.message);

  const targets = (data ?? []).map((t) => ({
    bucketId: t.bucket_id,
    targetPct: Number(t.target_pct),
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
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }

  const targets = parsed.data.targets;
  const bucketIds = targets.map((t) => t.bucketId);
  if (new Set(bucketIds).size !== bucketIds.length) {
    return apiError(400, "Дублирующиеся корзины в списке целей");
  }

  // Цель можно ставить только на видимую корзину (встроенную или свою)
  const { data: visibleBuckets, error: bucketsError } = await supabase
    .from("buckets")
    .select("id");
  if (bucketsError) return apiError(500, bucketsError.message);
  const visible = new Set((visibleBuckets ?? []).map((b) => b.id));
  const unknown = bucketIds.filter((id) => !visible.has(id));
  if (unknown.length > 0) {
    return apiError(400, "Неизвестные корзины", { unknown });
  }

  // Полная замена: удалить цели вне нового набора, апсертнуть новый набор
  let deleteQuery = supabase.from("target_allocations").delete().eq("user_id", user.id);
  if (bucketIds.length > 0) {
    deleteQuery = deleteQuery.not("bucket_id", "in", `(${bucketIds.join(",")})`);
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) return apiError(500, deleteError.message);

  if (targets.length > 0) {
    const { error: upsertError } = await supabase
      .from("target_allocations")
      .upsert(
        targets.map((t) => ({
          user_id: user.id,
          bucket_id: t.bucketId,
          target_pct: t.targetPct,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "user_id,bucket_id" },
      );
    if (upsertError) return apiError(500, upsertError.message);
  }

  // Предупреждение (не блокировка) при сумме != 100 (S1.6)
  const { sumPct, warning } = validateTargets(targets);
  return NextResponse.json({ targets, sumPct, warning });
}
