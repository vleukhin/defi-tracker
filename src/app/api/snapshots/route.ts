import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireUser } from "@/lib/api/auth";
import {
  DEFAULT_PERIOD,
  SNAPSHOT_COLUMNS,
  mapSnapshotRow,
  periodCutoff,
  snapshotPeriodSchema,
  type SnapshotRow,
} from "@/lib/api/snapshots";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSnapshot } from "@/lib/portfolio/snapshot";

/**
 * GET /api/snapshots[?period=7d|30d|90d|1y|all] — история портфеля (S3.2).
 *
 * Порядок — takenOn по ВОЗРАСТАНИЮ: график читается слева направо, и
 * переворачивать массив на клиенте не нужно.
 *
 * Пропущенные дни НЕ достраиваются: в ответе только реально снятые точки.
 * Интерполяция пропусков нарисовала бы ровную линию там, где данных не было
 * вовсе, — по S3.2 разрывы должны быть видны.
 */
export async function GET(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const periodParam = request.nextUrl.searchParams.get("period");
  const parsed = periodParam
    ? snapshotPeriodSchema.safeParse(periodParam)
    : { success: true as const, data: DEFAULT_PERIOD };
  if (!parsed.success) {
    return apiError(400, "Неизвестный период: 7d, 30d, 90d, 1y или all");
  }
  const period = parsed.data;

  let query = supabase
    .from("snapshots")
    .select(SNAPSHOT_COLUMNS)
    .order("taken_on", { ascending: true });

  const cutoff = periodCutoff(period);
  if (cutoff) query = query.gte("taken_on", cutoff);

  const { data, error } = await query;
  if (error) return apiError(500, error.message);

  const snapshots = ((data ?? []) as unknown as SnapshotRow[]).map(
    mapSnapshotRow,
  );

  return NextResponse.json({ snapshots, period, count: snapshots.length });
}

/**
 * POST /api/snapshots — кнопка «Снепшот сейчас» (S3.1).
 *
 * Перезаписывает снепшот за сегодняшний день (UNIQUE user_id + taken_on),
 * а не создает второй: история — это одна точка на день. Цены при этом
 * дотягиваются при истекшем TTL, залог берется из кэша (чтение сетей —
 * отдельная кнопка «Обновить», чтобы снепшот не ждал четыре RPC).
 */
export async function POST() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  try {
    const admin = createAdminClient();
    const { snapshot, partialReasons } = await createSnapshot(
      supabase,
      admin,
      user.id,
    );
    return NextResponse.json({ snapshot, partialReasons }, { status: 201 });
  } catch (err) {
    return apiError(
      500,
      err instanceof Error ? err.message : "Не удалось снять снепшот",
    );
  }
}
