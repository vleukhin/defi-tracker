import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLinkedMessage } from "./message";
import {
  getTelegramToken,
  getTelegramUpdates,
  parseStartCommand,
  sendTelegramMessage,
  formatTelegramMessage,
} from "./telegram";
import type { ChannelSendOptions } from "./types";

/**
 * Привязка телеграм-чата к пользователю.
 *
 * Как это работает: в настройках выдаётся одноразовый код, пользователь
 * отправляет боту `/start <код>`, а мы забираем сообщение методом getUpdates
 * и записываем chat_id в канал с этим кодом. Вебхука нет — забирать
 * обновления можно из крона, который и так ходит каждые пятнадцать минут,
 * и из кнопки «Проверить», чтобы не ждать эти пятнадцать минут.
 *
 * Код — секрет на время жизни: тот, кто его перехватит, направит чужие
 * уведомления о HF себе. Отсюда 40 бит энтропии, одноразовость и короткий
 * срок; сам чат при этом закреплён уникальным индексом и не может
 * обслуживать двух пользователей.
 */

/** Сколько живёт код привязки. Дольше — дольше окно перехвата. */
export const LINK_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * Алфавит без похожих символов: код диктуют и перепечатывают руками,
 * а «0/O» и «1/I» в таком коде — гарантированная ошибка ввода.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function generateLinkCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

export interface ConsumeUpdatesResult {
  /** Сколько чатов привязалось за этот проход. */
  linked: number;
  /** Сколько обновлений просмотрено. */
  seen: number;
  error?: string;
}

/**
 * Забирает накопившиеся сообщения и привязывает те, что несут годный код.
 *
 * Offset подтверждает обработку: телеграм больше не отдаст эти обновления,
 * поэтому он сдвигается ВСЕГДА, даже если код оказался просроченным.
 * Иначе одно чужое сообщение боту навсегда заклинило бы очередь.
 */
export async function consumeTelegramUpdates(
  admin: SupabaseClient,
  opts: ChannelSendOptions = {},
): Promise<ConsumeUpdatesResult> {
  const token = getTelegramToken();
  if (token === null) {
    return { linked: 0, seen: 0, error: "TELEGRAM_BOT_TOKEN не задан" };
  }

  const { data: stateRow, error: stateError } = await admin
    .from("telegram_bot_state")
    .select("update_offset")
    .maybeSingle();
  if (stateError) {
    return { linked: 0, seen: 0, error: `telegram_bot_state: ${stateError.message}` };
  }
  const offset = stateRow === null ? 0 : Number(stateRow.update_offset);

  const updates = await getTelegramUpdates(token, offset, opts);
  if (!updates.ok) return { linked: 0, seen: 0, error: updates.error };
  if (updates.updates.length === 0) return { linked: 0, seen: 0 };

  let linked = 0;
  const nowIso = new Date().toISOString();

  for (const update of updates.updates) {
    const code = parseStartCommand(update.text);
    if (code === null) continue;

    const { data: channel, error } = await admin
      .from("notification_channels")
      .select("id, user_id, link_code_expires_at")
      .eq("kind", "telegram")
      .eq("link_code", code)
      .maybeSingle();
    if (error) {
      console.warn(`[telegram-link] поиск кода: ${error.message}`);
      continue;
    }
    // Неизвестный или просроченный код: отвечать «код не найден» не станем —
    // это подсказало бы перебирающему, что он близко
    if (channel === null) continue;
    if (
      channel.link_code_expires_at !== null &&
      Date.parse(channel.link_code_expires_at) < Date.now()
    ) {
      continue;
    }

    const { error: updateError } = await admin
      .from("notification_channels")
      .update({
        config: { chatId: update.chatId, chatTitle: update.chatTitle },
        verified_at: nowIso,
        enabled: true,
        // Код одноразовый: гасим сразу, чтобы вторая привязка тем же кодом
        // была невозможна
        link_code: null,
        link_code_expires_at: null,
        last_error: null,
        updated_at: nowIso,
      })
      .eq("id", channel.id);
    if (updateError) {
      // Чаще всего это уникальный индекс: чат уже привязан к другому
      // пользователю. Молча пропускаем — чужой канал не трогаем
      console.warn(`[telegram-link] привязка не удалась: ${updateError.message}`);
      continue;
    }

    linked += 1;

    const greeting = buildLinkedMessage();
    const sent = await sendTelegramMessage(
      token,
      update.chatId,
      formatTelegramMessage(greeting),
      opts,
    );
    await admin.from("notification_log").insert({
      user_id: channel.user_id,
      channel_id: channel.id,
      kind: "telegram",
      event: "linked",
      body: formatTelegramMessage(greeting),
      ok: sent.ok,
      error: sent.error ?? null,
    });
  }

  const nextOffset =
    Math.max(...updates.updates.map((u) => u.updateId)) + 1;
  const { error: offsetError } = await admin
    .from("telegram_bot_state")
    .upsert(
      { singleton: true, update_offset: nextOffset, updated_at: nowIso },
      { onConflict: "singleton" },
    );
  if (offsetError) {
    // Не сдвинувшийся offset означает повторную обработку тех же сообщений
    // на следующем прогоне: привязка идемпотентна, так что это переживём
    console.warn(`[telegram-link] offset не сохранён: ${offsetError.message}`);
  }

  return { linked, seen: updates.updates.length };
}
