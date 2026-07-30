import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import {
  TRADE_COLUMNS,
  mapTradeRow,
  toTradeColumns,
  tradeSchema,
  type TradeRow,
} from "@/lib/api/trades";

/**
 * PUT /api/trades/{id} — полная замена полей сделки (тот же состав, что POST);
 * производные величины пересчитываются реплеем при следующем чтении (S2.1).
 * RLS не дает трогать чужие сделки — для клиента это неотличимо от 404.
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
  const parsed = tradeSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Невалидные данные", {
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  const { data, error } = await supabase
    .from("trades")
    .update(toTradeColumns(parsed.data))
    .eq("id", id)
    .select(TRADE_COLUMNS);
  if (error) return apiError(500, error.message);
  if (!data || data.length === 0) return apiError(404, "Сделка не найдена");

  return NextResponse.json({ trade: mapTradeRow(data[0] as TradeRow) });
}

/** DELETE /api/trades/{id} — удалить сделку (RLS: только свою). */
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
    .from("trades")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return apiError(500, error.message);
  if (!data || data.length === 0) return apiError(404, "Сделка не найдена");

  return NextResponse.json({ deleted: true, id });
}
