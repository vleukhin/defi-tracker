import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/health — проверка окружения и доступности БД (для мониторинга).
 * Публичный роут (см. src/lib/supabase/middleware.ts); значения секретов
 * не раскрывает — только флаги наличия.
 */

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ALCHEMY_API_KEY",
  "COINGECKO_API_KEY",
] as const;

export async function GET() {
  const env = Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, Boolean(process.env[name])]),
  ) as Record<(typeof REQUIRED_ENV)[number], boolean>;

  let db = false;
  let dbError: string | null = null;
  try {
    const admin = createAdminClient();
    // assets — справочная таблица, существует с первой миграции
    const { error } = await admin.from("assets").select("id").limit(1);
    db = !error;
    dbError = error?.message ?? null;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const ok = db && Object.values(env).every(Boolean);
  return NextResponse.json(
    { ok, checks: { env, db, dbError } },
    { status: ok ? 200 : 503 },
  );
}
