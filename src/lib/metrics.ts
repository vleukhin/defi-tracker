import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Счетчики исходящих вызовов внешних API (ТЗ Часть 4 §2: с первого дня).
 * Одна строка api_call_log на исходящий батч; fire-and-forget —
 * сбой логирования никогда не роняет основной пайплайн.
 */

export type ApiProvider =
  | "coingecko"
  | "alchemy"
  | "rpc"
  | "zerion"
  // Фаза 5: цены GM-токенов и состав пулов (arbitrum-api.gmxinfra.io)
  | "gmx"
  // Фаза 6: доставка уведомлений (api.telegram.org)
  | "telegram";

export async function logApiCall(
  provider: ApiProvider,
  endpoint: string,
  opts: { units?: number; ok?: boolean } = {},
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("api_call_log").insert({
      provider,
      endpoint,
      units: opts.units ?? 1,
      ok: opts.ok ?? true,
    });
    if (error) {
      console.warn(`[metrics] не удалось записать api_call_log: ${error.message}`);
    }
  } catch (err) {
    console.warn("[metrics] не удалось записать api_call_log:", err);
  }
}
