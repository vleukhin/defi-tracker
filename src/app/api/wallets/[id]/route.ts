import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";

/**
 * DELETE /api/wallets/{id} — удалить кошелек.
 * Каскад БД убирает balances_cache — балансы исчезают из портфеля (S1.2).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { id } = await params;
  if (!z.guid().safeParse(id).success) {
    return apiError(400, "Невалидный id кошелька");
  }

  // RLS гарантирует, что удалить можно только свой кошелек
  const { data, error } = await supabase
    .from("wallets")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return apiError(500, error.message);
  if (!data || data.length === 0) return apiError(404, "Кошелек не найден");

  return NextResponse.json({ deleted: true, id });
}
