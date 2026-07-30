import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";

/** DELETE /api/portfolio/manual/{id} — удаление ручной записи (RLS: только своей). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { id } = await params;
  // z.guid(), не z.uuid(): последняя требует строгую RFC-версию UUID
  if (!z.guid().safeParse(id).success) {
    return apiError(400, "Некорректный id");
  }

  const { data, error } = await supabase
    .from("manual_positions")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return apiError(500, error.message);
  if (!data || data.length === 0) return apiError(404, "Запись не найдена");

  return NextResponse.json({ deleted: true, id });
}
