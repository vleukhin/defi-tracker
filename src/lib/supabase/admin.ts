import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role клиент Supabase: ОБХОДИТ RLS.
 * Только для серверных модулей (reader, цены, метрики) — запись в общие
 * справочники (assets, price_cache, balances_cache, api_call_log).
 *
 * Импорт "server-only" гарантирует ошибку сборки при попадании
 * в клиентский бандл. Никогда не импортировать из client components.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы",
    );
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
