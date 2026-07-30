import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import {
  DEPOSIT_COLUMNS,
  depositSchema,
  mapDepositRow,
  toDepositColumns,
  type DepositRow,
} from "@/lib/api/deposits";

/**
 * PUT /api/deposits/{id} — полная замена полей записи (тот же состав, что
 * POST); «Внесено» пересчитывается суммой журнала при следующем чтении.
 * RLS не дает трогать чужие записи — для клиента это неотличимо от 404.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { id } = await params;
  // z.guid(), не z.uuid(): последняя требует строгую RFC-версию UUID
  if (!z.guid().safeParse(id).success) {
    return apiError(400, "Некорректный id");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Невалидный JSON");
  }
  const parsed = depositSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Невалидные данные", {
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  const { data, error } = await supabase
    .from("deposits")
    .update(toDepositColumns(parsed.data))
    .eq("id", id)
    .select(DEPOSIT_COLUMNS);
  if (error) return apiError(500, error.message);
  if (!data || data.length === 0) return apiError(404, "Запись не найдена");

  return NextResponse.json({ deposit: mapDepositRow(data[0] as DepositRow) });
}

/** DELETE /api/deposits/{id} — удалить запись (RLS: только свою). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { id } = await params;
  if (!z.guid().safeParse(id).success) {
    return apiError(400, "Некорректный id");
  }

  const { data, error } = await supabase
    .from("deposits")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return apiError(500, error.message);
  if (!data || data.length === 0) return apiError(404, "Запись не найдена");

  return NextResponse.json({ deleted: true, id });
}
