import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import {
  SNAPSHOT_COLUMNS,
  mapSnapshotRow,
  type SnapshotRow,
} from "@/lib/api/snapshots";

/**
 * GET /api/snapshots/{id} — один снепшот с полным составом: проваливание
 * из списка в состав портфеля на дату (S3.2).
 *
 * Чужой снепшот RLS не отдает — для клиента это неотличимо от 404.
 */
export async function GET(
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
    .from("snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("id", id);
  if (error) return apiError(500, error.message);
  if (!data || data.length === 0) return apiError(404, "Снепшот не найден");

  return NextResponse.json({
    snapshot: mapSnapshotRow(data[0] as unknown as SnapshotRow),
  });
}
