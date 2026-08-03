import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireUser } from "@/lib/api/auth";
import {
  DEFAULT_HF_WARNING_THRESHOLD,
  DEFAULT_TARGET_LTV_PCT,
  settingsSchema,
} from "@/lib/api/settings";

/**
 * Настройки пользователя: порог предупреждения по health factor и целевой
 * LTV стратегии.
 *
 * GET /api/settings — { hfWarningThreshold, targetLtvPct }. Строка
 * user_settings не создается впрок: до первого PUT отдаются дефолты из кода —
 * пустая таблица и «строка с дефолтами» означают одно и то же.
 *
 * PUT /api/settings — частичный: любое подмножество полей. Экран «Долг»
 * правит только целевой LTV, «Настройки» — только порог HF, и ни один
 * не обязан пересылать чужую настройку. Непереданное читается из своей
 * строки и переписывается тем же значением: иначе upsert при создании
 * строки сбросил бы соседнюю настройку на дефолт.
 */

type Stored = { hfWarningThreshold: number; targetLtvPct: number };

/** Строка таблицы или дефолты, если строки ещё нет. */
function fromRow(
  row: { hf_warning_threshold: unknown; target_ltv_pct: unknown } | null,
): Stored {
  return {
    hfWarningThreshold:
      row === null
        ? DEFAULT_HF_WARNING_THRESHOLD
        : Number(row.hf_warning_threshold),
    targetLtvPct:
      row === null ? DEFAULT_TARGET_LTV_PCT : Number(row.target_ltv_pct),
  };
}

export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { data, error } = await supabase
    .from("user_settings")
    .select("hf_warning_threshold, target_ltv_pct")
    .maybeSingle();
  if (error) return apiError(500, error.message);

  return NextResponse.json(fromRow(data));
}

export async function PUT(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Невалидный JSON");
  }
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Невалидные данные", {
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  const { data: existing, error: readError } = await supabase
    .from("user_settings")
    .select("hf_warning_threshold, target_ltv_pct")
    .maybeSingle();
  if (readError) return apiError(500, readError.message);

  const current = fromRow(existing);
  const next: Stored = {
    hfWarningThreshold:
      parsed.data.hfWarningThreshold ?? current.hfWarningThreshold,
    targetLtvPct: parsed.data.targetLtvPct ?? current.targetLtvPct,
  };

  const { data, error } = await supabase
    .from("user_settings")
    .upsert(
      {
        user_id: user.id,
        hf_warning_threshold: next.hfWarningThreshold,
        target_ltv_pct: next.targetLtvPct,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("hf_warning_threshold, target_ltv_pct")
    .single();
  if (error) return apiError(500, error.message);

  return NextResponse.json(fromRow(data));
}
