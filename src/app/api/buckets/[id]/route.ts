import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";

/**
 * DELETE /api/buckets/{id} — удалить свою корзину.
 * Встроенные корзины удалить нельзя (RLS: delete только своих).
 * Каскад БД чистит asset_bucket_map и target_allocations —
 * активы корзины возвращаются в дефолтный маппинг / «Прочее».
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return apiError(400, "Невалидный id корзины");
  }

  const { data, error } = await supabase
    .from("buckets")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return apiError(500, error.message);
  if (!data || data.length === 0) {
    return apiError(404, "Корзина не найдена или встроенная");
  }

  return NextResponse.json({ deleted: true, id });
}
