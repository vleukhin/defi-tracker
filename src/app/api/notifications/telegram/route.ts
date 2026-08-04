import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError, requireUser } from "@/lib/api/auth";
import {
  notificationActionSchema,
  notificationPatchSchema,
} from "@/lib/api/notifications";
import type {
  NotificationChannelDto,
  NotificationStatusDto,
} from "@/lib/api/types";
import { sendToChannel, type ChannelRow } from "@/lib/notifications/dispatch";
import { buildTestMessage } from "@/lib/notifications/message";
import {
  consumeTelegramUpdates,
  generateLinkCode,
  LINK_CODE_TTL_MS,
} from "@/lib/notifications/telegram-link";
import {
  getTelegramBotUsername,
  isTelegramConfigured,
} from "@/lib/notifications/telegram";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Канал уведомлений «телеграм» (Фаза 6).
 *
 *  GET    — состояние канала и действующий код привязки;
 *  POST   — { action: 'link' | 'poll' | 'test' };
 *  PATCH  — { enabled } — временно замолчать, не теряя привязку;
 *  DELETE — отключить канал совсем.
 *
 * Чтение и правка идут под сессией пользователя (RLS сама режет по
 * auth.uid()). Под service-role выполняются только два шага, которым нужен
 * доступ к чужим строкам по своей природе: разбор входящих сообщений бота
 * (в них ещё неизвестно, чей это чат) и запись в закрытый журнал отправок.
 */

interface ChannelDbRow {
  id: string;
  kind: string;
  config: { chatTitle?: unknown } | null;
  enabled: boolean;
  verified_at: string | null;
  link_code: string | null;
  link_code_expires_at: string | null;
  last_sent_at: string | null;
  last_error: string | null;
}

const CHANNEL_COLUMNS =
  "id, kind, config, enabled, verified_at, link_code, link_code_expires_at, last_sent_at, last_error";

function toDto(row: ChannelDbRow): NotificationChannelDto {
  const title = row.config?.chatTitle;
  return {
    kind: "telegram",
    enabled: row.enabled,
    verified: row.verified_at !== null,
    chatTitle: typeof title === "string" ? title : null,
    lastSentAt: row.last_sent_at,
    lastError: row.last_error,
  };
}

/** Код показывается, только пока он действует: истёкший вводить бессмысленно. */
function activeCode(row: ChannelDbRow): {
  linkCode: string | null;
  linkCodeExpiresAt: string | null;
} {
  if (row.link_code === null) return { linkCode: null, linkCodeExpiresAt: null };
  if (
    row.link_code_expires_at !== null &&
    Date.parse(row.link_code_expires_at) < Date.now()
  ) {
    return { linkCode: null, linkCodeExpiresAt: null };
  }
  return {
    linkCode: row.link_code,
    linkCodeExpiresAt: row.link_code_expires_at,
  };
}

async function loadChannel(
  supabase: SupabaseClient,
): Promise<ChannelDbRow | null> {
  const { data, error } = await supabase
    .from("notification_channels")
    .select(CHANNEL_COLUMNS)
    .eq("kind", "telegram")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ChannelDbRow | null) ?? null;
}

function statusResponse(row: ChannelDbRow | null): NotificationStatusDto {
  return {
    channel: row === null ? null : toDto(row),
    botUsername: getTelegramBotUsername(),
    botConfigured: isTelegramConfigured(),
    ...(row === null
      ? { linkCode: null, linkCodeExpiresAt: null }
      : activeCode(row)),
  };
}

export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  try {
    return NextResponse.json(statusResponse(await loadChannel(supabase)));
  } catch (err) {
    return apiError(500, err instanceof Error ? err.message : String(err));
  }
}

export async function POST(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Невалидный JSON");
  }
  const parsed = notificationActionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Невалидные данные", {
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }

  try {
    const existing = await loadChannel(supabase);

    if (parsed.data.action === "link") {
      // Без бота код мёртв: разобрать «/start» будет нечем, а строка
      // в notification_channels останется и будет выглядеть как начатая
      // привязка. Проверка стоит здесь, а не только в интерфейсе
      if (!isTelegramConfigured()) {
        return apiError(
          409,
          "Бот не настроен на сервере: не задан TELEGRAM_BOT_TOKEN",
        );
      }
      // Новый код выдаётся и уже привязанному каналу: так переносят
      // уведомления в другой чат, не теряя настроек
      const code = generateLinkCode();
      const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
      const nowIso = new Date().toISOString();

      const { data, error } = await supabase
        .from("notification_channels")
        .upsert(
          {
            user_id: user.id,
            kind: "telegram",
            link_code: code,
            link_code_expires_at: expiresAt,
            updated_at: nowIso,
            ...(existing === null ? { config: {}, enabled: true } : {}),
          },
          { onConflict: "user_id,kind" },
        )
        .select(CHANNEL_COLUMNS)
        .single();
      if (error) return apiError(500, error.message);

      return NextResponse.json(statusResponse(data as ChannelDbRow));
    }

    if (parsed.data.action === "poll") {
      if (existing === null) {
        return apiError(409, "Сначала получите код привязки");
      }
      // Разбор входящих требует service-role: в сообщении бота ещё
      // неизвестно, какому пользователю принадлежит код
      const admin = createAdminClient();
      const result = await consumeTelegramUpdates(admin);
      if (result.error) {
        return apiError(502, `Телеграм недоступен: ${result.error}`);
      }
      return NextResponse.json({
        ...statusResponse(await loadChannel(supabase)),
        linked: result.linked,
      });
    }

    // action === 'test'
    if (existing === null || existing.verified_at === null) {
      return apiError(409, "Канал ещё не привязан");
    }
    const admin = createAdminClient();
    const channel: ChannelRow = {
      id: existing.id,
      user_id: user.id,
      kind: "telegram",
      config: existing.config,
      enabled: existing.enabled,
      verified_at: existing.verified_at,
    };
    const sent = await sendToChannel(admin, channel, "test", buildTestMessage());
    if (!sent.ok) {
      return apiError(502, sent.error ?? "Не удалось отправить сообщение");
    }
    return NextResponse.json(statusResponse(await loadChannel(supabase)));
  } catch (err) {
    return apiError(500, err instanceof Error ? err.message : String(err));
  }
}

export async function PATCH(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Невалидный JSON");
  }
  const parsed = notificationPatchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Невалидные данные", {
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }

  const { data, error } = await supabase
    .from("notification_channels")
    .update({
      enabled: parsed.data.enabled,
      // Включение вручную снимает отметку об ошибке: пользователь говорит,
      // что починил (разблокировал бота), и следующая попытка это проверит
      ...(parsed.data.enabled ? { last_error: null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("kind", "telegram")
    .select(CHANNEL_COLUMNS)
    .maybeSingle();
  if (error) return apiError(500, error.message);
  if (data === null) return apiError(404, "Канал не найден");

  return NextResponse.json(statusResponse(data as ChannelDbRow));
}

export async function DELETE() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { error } = await supabase
    .from("notification_channels")
    .delete()
    .eq("kind", "telegram");
  if (error) return apiError(500, error.message);

  return NextResponse.json(statusResponse(null));
}
