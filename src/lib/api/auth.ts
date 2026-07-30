import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Проверка сессии в API-роутах. RLS изолирует данные на уровне БД,
 * но каждый роут дополнительно проверяет сессию и отвечает 401 (S1.1).
 */
export async function requireUser(): Promise<
  | { user: User; supabase: SupabaseClient; unauthorized: null }
  | { user: null; supabase: SupabaseClient; unauthorized: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

/** Единый формат ошибок API. */
export function apiError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}
