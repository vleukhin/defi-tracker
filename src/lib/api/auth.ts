import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { verifiedUser, type SessionUser } from "@/lib/supabase/session";

/**
 * Проверка сессии в API-роутах. RLS изолирует данные на уровне БД,
 * но каждый роут дополнительно проверяет сессию и отвечает 401 (S1.1).
 *
 * Проверка локальная (подпись JWT), а не запросом к Auth — см. session.ts.
 * Именно поэтому «защита в глубину» здесь ничего не стоит: прокси уже
 * проверил тот же токен, и повторная проверка не идёт в сеть.
 */
export async function requireUser(): Promise<
  | { user: SessionUser; supabase: SupabaseClient; unauthorized: null }
  | { user: null; supabase: SupabaseClient; unauthorized: NextResponse }
> {
  const supabase = await createClient();
  const user = await verifiedUser(supabase);

  if (!user) {
    return {
      user: null,
      supabase,
      unauthorized: NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 },
      ),
    };
  }
  return { user, supabase, unauthorized: null };
}

/**
 * Роль администратора хранится в app_metadata.role (задается только через
 * админ-API service-role: сид-скрипт или роут /api/admin/users) и попадает
 * в подписанный JWT — пользователь не может выставить ее сам.
 */
export function isAdmin(user: SessionUser): boolean {
  return user.app_metadata?.role === "admin";
}

/** Как requireUser, но дополнительно требует роль администратора (403 иначе). */
export async function requireAdmin(): Promise<
  | { user: SessionUser; supabase: SupabaseClient; unauthorized: null }
  | { user: null; supabase: SupabaseClient; unauthorized: NextResponse }
> {
  const result = await requireUser();
  if (result.unauthorized) return result;
  if (!isAdmin(result.user)) {
    return {
      user: null,
      supabase: result.supabase,
      unauthorized: NextResponse.json(
        { error: "Требуются права администратора" },
        { status: 403 },
      ),
    };
  }
  return result;
}

/** Единый формат ошибок API. */
export function apiError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}
