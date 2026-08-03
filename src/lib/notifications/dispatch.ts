import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getChannel, isKnownChannelKind } from "./registry";
import { formatTelegramMessage } from "./telegram";
import type { ChannelSendOptions, OutgoingMessage } from "./types";

/**
 * Доставка сообщения во все каналы пользователя.
 *
 * Работает под service-role: крон ходит от имени системы, а не сессии.
 * Каждая попытка попадает в notification_log — «почему не пришло» иначе
 * не разобрать, а канал, молча перестающий работать, хуже отсутствующего.
 */

export interface ChannelRow {
  id: string;
  user_id: string;
  kind: string;
  config: unknown;
  enabled: boolean;
  verified_at: string | null;
}

export interface DispatchResult {
  sent: number;
  failed: number;
  errors: string[];
}

/** Каналы, которым есть смысл слать: включённые и подтверждённые. */
export async function loadDeliverableChannels(
  admin: SupabaseClient,
  userId: string,
): Promise<ChannelRow[]> {
  const { data, error } = await admin
    .from("notification_channels")
    .select("id, user_id, kind, config, enabled, verified_at")
    .eq("user_id", userId)
    .eq("enabled", true)
    .not("verified_at", "is", null);
  if (error) throw new Error(`notification_channels select: ${error.message}`);
  return (data ?? []) as ChannelRow[];
}

/**
 * Отправка в один канал с записью в журнал. Ошибка доставки не бросается:
 * упавший канал не должен отменять мониторинг остальных кошельков.
 */
export async function sendToChannel(
  admin: SupabaseClient,
  channel: ChannelRow,
  event: string,
  message: OutgoingMessage,
  opts: ChannelSendOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!isKnownChannelKind(channel.kind)) {
    return { ok: false, error: `неизвестный канал: ${channel.kind}` };
  }

  const result = await getChannel(channel.kind).send(
    channel.config,
    message,
    opts,
  );

  // Тело пишем целиком: воспроизвести текст задним числом нельзя — он
  // зависел от порога и HF на тот момент, а оспаривается именно текст
  const { error: logError } = await admin.from("notification_log").insert({
    user_id: channel.user_id,
    channel_id: channel.id,
    kind: channel.kind,
    event,
    body: formatTelegramMessage(message),
    ok: result.ok,
    error: result.error ?? null,
  });
  if (logError) {
    console.warn(`[notify] журнал не записан: ${logError.message}`);
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    last_error: result.error ?? null,
  };
  if (result.ok) patch.last_sent_at = new Date().toISOString();
  // Адресат недоступен навсегда — гасим канал, а не долбимся каждые
  // пятнадцать минут. Пользователь увидит причину в настройках.
  if (result.disable) patch.enabled = false;

  const { error: updateError } = await admin
    .from("notification_channels")
    .update(patch)
    .eq("id", channel.id);
  if (updateError) {
    console.warn(`[notify] статус канала не обновлён: ${updateError.message}`);
  }

  return { ok: result.ok, ...(result.error ? { error: result.error } : {}) };
}

/** Разослать событие по всем пригодным каналам пользователя. */
export async function sendToUser(
  admin: SupabaseClient,
  userId: string,
  event: string,
  message: OutgoingMessage,
  opts: ChannelSendOptions = {},
): Promise<DispatchResult> {
  const channels = await loadDeliverableChannels(admin, userId);
  const result: DispatchResult = { sent: 0, failed: 0, errors: [] };

  for (const channel of channels) {
    const attempt = await sendToChannel(admin, channel, event, message, opts);
    if (attempt.ok) {
      result.sent += 1;
    } else {
      result.failed += 1;
      result.errors.push(`${channel.kind}: ${attempt.error ?? "ошибка"}`);
    }
  }
  return result;
}
