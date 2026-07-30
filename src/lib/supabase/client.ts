import { createBrowserClient } from "@supabase/ssr";
import { supabaseUrl } from "./url";

/**
 * Supabase-клиент для браузера (client components).
 */
export function createClient() {
  return createBrowserClient(
    supabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
