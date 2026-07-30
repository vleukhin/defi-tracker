import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireUser } from "@/lib/api/auth";
import {
  DEFAULT_HF_WARNING_THRESHOLD,
  settingsSchema,
} from "@/lib/api/settings";

/**
 * Настройки пользователя (Фаза 4): порог предупреждения по health factor.
 *
 * GET /api/settings — { hfWarningThreshold }. Строка user_settings не
 * создается впрок: до первого PUT отдается дефолт из кода (1.5) — пустая
 * таблица и «строка с дефолтом» означают одно и то же.
 *
 * PUT /api/settings — { hfWarningThreshold: 1 < x <= 10 }, upsert своей строки.
 */
export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { data, error } = await supabase
    .from("user_settings")
    .select("hf_warning_threshold")
    .maybeSingle();
  if (error) return apiError(500, error.message);

  return NextResponse.json({
    hfWarningThreshold:
      data === null
        ? DEFAULT_HF_WARNING_THRESHOLD
        : Number(data.hf_warning_threshold),
  });
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

  const { data, error } = await supabase
    .from("user_settings")
    .upsert(
      {
        user_id: user.id,
        hf_warning_threshold: parsed.data.hfWarningThreshold,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("hf_warning_threshold")
    .single();
  if (error) return apiError(500, error.message);

  return NextResponse.json({
    hfWarningThreshold: Number(data.hf_warning_threshold),
  });
}
