import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireUser } from "@/lib/api/auth";
import { periodCutoff, snapshotPeriodSchema } from "@/lib/api/snapshots";
import type { ClosedPositionsResponseDto, SnapshotPeriod } from "@/lib/api/types";
import {
  buildClosedPositions,
  CLOSURE_COLUMNS,
  type ClosureReadRow,
} from "@/lib/positions/closures";

/**
 * GET /api/positions/closed[?period=7d|30d|90d|1y|all] — архив закрытых
 * позиций размещения.
 *
 * Только собственная таблица: ни RPC, ни цен. Запись создаёт обновление
 * в момент, когда позиция исчезла из успешного чтения, — здесь её только
 * читают и собирают DTO.
 *
 * УМОЛЧАНИЕ — «ВСЁ ВРЕМЯ», в отличие от снепшотов, где умолчание месяц.
 * Закрытия редки: за месяц их может не быть вовсе, и экран по умолчанию
 * отвечал бы «записей нет» на вопрос «что у меня было».
 */

const DEFAULT_CLOSED_PERIOD: SnapshotPeriod = "all";

export async function GET(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const periodParam = request.nextUrl.searchParams.get("period");
  const parsed = periodParam ? snapshotPeriodSchema.safeParse(periodParam) : null;
  if (parsed && !parsed.success) return apiError(400, "Неизвестный период");
  const period = parsed ? parsed.data : DEFAULT_CLOSED_PERIOD;

  let query = supabase
    .from("closed_positions")
    // Подпись кошелька embedded-ресурсом: отдельным запросом она стоила бы
    // второго похода ради одной строки на запись
    .select(`${CLOSURE_COLUMNS}, wallets (label)`)
    // Тайбрейк по id обязателен: пачка закрытий одного обновления получает
    // один closed_at, и без него порядок внутри пачки зависел бы от плана
    .order("closed_at", { ascending: false })
    .order("id", { ascending: false });

  const cutoff = periodCutoff(period);
  if (cutoff) query = query.gte("closed_at", cutoff);

  const { data, error } = await query;
  if (error) return apiError(500, error.message);

  const rows: ClosureReadRow[] = (data ?? []).map((row) => {
    const { wallets, ...rest } = row as Record<string, unknown> & {
      wallets?: { label: string | null } | { label: string | null }[] | null;
    };
    const wallet = Array.isArray(wallets) ? (wallets[0] ?? null) : (wallets ?? null);
    return {
      ...(rest as unknown as ClosureReadRow),
      walletLabel: wallet?.label ?? null,
    };
  });

  const closed = buildClosedPositions(rows);
  return NextResponse.json({
    closed,
    period,
    count: closed.length,
  } satisfies ClosedPositionsResponseDto);
}
