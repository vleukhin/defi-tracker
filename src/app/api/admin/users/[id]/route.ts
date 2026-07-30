import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, apiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** Удаление пользователя администратором. Данные (кошельки, цели, сделки) удаляются каскадом FK. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, unauthorized } = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  if (!z.guid().safeParse(id).success) {
    return apiError(400, "Некорректный id");
  }
  if (id === user.id) {
    return apiError(400, "Нельзя удалить собственный аккаунт");
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return apiError(502, `Не удалось удалить: ${error.message}`);

  return NextResponse.json({ deleted: true, id });
}
