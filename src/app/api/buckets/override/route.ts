import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";

/**
 * PUT /api/buckets/override — перенос актива в корзину (S1.6):
 * пользовательский override поверх дефолтного маппинга.
 * bucketId: null — снять override (вернуться к дефолту / «Прочее»).
 */

const putSchema = z.object({
  assetId: z.guid(),
  bucketId: z.guid().nullable(),
});

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
  const { assetId, bucketId } = parsed.data;

  // Актив должен существовать (справочник читаем для authenticated)
  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .select("id")
    .eq("id", assetId)
    .maybeSingle();
  if (assetError) return apiError(500, assetError.message);
  if (!asset) return apiError(404, "Актив не найден");

  if (bucketId !== null) {
    // Корзина должна быть видимой: встроенной или своей
    const { data: bucket, error: bucketError } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", bucketId)
      .maybeSingle();
    if (bucketError) return apiError(500, bucketError.message);
    if (!bucket) return apiError(404, "Корзина не найдена");
  }

  // Идемпотентная замена своего override (delete + insert)
  const { error: deleteError } = await supabase
    .from("asset_bucket_map")
    .delete()
    .eq("user_id", user.id)
    .eq("asset_id", assetId);
  if (deleteError) return apiError(500, deleteError.message);

  if (bucketId === null) {
    return NextResponse.json({ assetId, bucketId: null, overridden: false });
  }

  const { error: insertError } = await supabase
    .from("asset_bucket_map")
    .insert({ user_id: user.id, asset_id: assetId, bucket_id: bucketId });
  if (insertError) return apiError(500, insertError.message);

  return NextResponse.json({ assetId, bucketId, overridden: true });
}
