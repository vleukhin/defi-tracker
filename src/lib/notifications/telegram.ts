import { logApiCall } from "@/lib/metrics";
import type {
  ChannelSendOptions,
  DeliveryResult,
  NotificationChannel,
  OutgoingMessage,
} from "./types";

/**
 * Канал доставки: телеграм-бот (Bot API).
 *
 * Один бот на всё приложение (токен в TELEGRAM_BOT_TOKEN), адресат —
 * chat_id в config канала. Вебхука нет: обновления забираются getUpdates
 * из крона, который и так ходит каждые пятнадцать минут. Публичный
 * вебхук-роут пришлось бы открывать в интернет и защищать отдельно, а
 * выигрыш — только скорость привязки, которую закрывает кнопка «Проверить».
 *
 * Текст отправляется без parse_mode. Разметка потребовала бы экранирования
 * (в MarkdownV2 спецсимволы — это в том числе точка и минус, а у нас они
 * в каждом числе), и цена ошибки экранирования — не кривой шрифт, а
 * недоставленное предупреждение о ликвидации.
 */

const API_BASE = "https://api.telegram.org";

/** Ретрай при 429 ждёт не дольше этого: у крона свой бюджет времени. */
const MAX_RETRY_AFTER_MS = 5_000;

export function getTelegramToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

/** Имя бота для ссылки t.me — только для интерфейса привязки. */
export function getTelegramBotUsername(): string | null {
  return process.env.TELEGRAM_BOT_USERNAME || null;
}

/**
 * Есть ли на сервере бот вообще. Признак — токен: без него привязка
 * невозможна в принципе, тогда как без TELEGRAM_BOT_USERNAME теряется
 * только ссылка t.me, а ручное «/start <код>» продолжает работать.
 *
 * Наружу отдаётся именно факт, а не токен: интерфейсу нужно знать, что
 * предлагать нечего, и ничего больше.
 */
export function isTelegramConfigured(): boolean {
  return getTelegramToken() !== null;
}

/** chat_id из config канала; null = канал не привязан. */
export function telegramChatId(config: unknown): number | null {
  if (typeof config !== "object" || config === null) return null;
  const value = (config as { chatId?: unknown }).chatId;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface TelegramApiError {
  status: number;
  description: string;
  retryAfterMs: number | null;
}

/**
 * Ответы, после которых слать в этот чат бессмысленно до новой привязки.
 * Всё остальное (5xx, таймауты, сеть) — временное: канал не гасим, иначе
 * пятиминутная авария у телеграма молча отключила бы предупреждения.
 */
function isPermanentFailure(status: number, description: string): boolean {
  const text = description.toLowerCase();
  if (status === 403) return true; // bot was blocked / kicked
  if (status === 400 && text.includes("chat not found")) return true;
  if (status === 400 && text.includes("user is deactivated")) return true;
  return false;
}

interface TelegramCallResult<T> {
  ok: boolean;
  result?: T;
  error?: TelegramApiError;
}

async function callTelegram<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  opts: ChannelSendOptions = {},
): Promise<TelegramCallResult<T>> {
  const doFetch = opts.fetchFn ?? fetch;
  const logCall = opts.logCall ?? logApiCall;

  let res: Response;
  try {
    res = await doFetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    void logCall("telegram", method, { ok: false });
    return {
      ok: false,
      error: {
        status: 0,
        description: err instanceof Error ? err.message : String(err),
        retryAfterMs: null,
      },
    };
  }

  const body: unknown = await res.json().catch(() => null);
  void logCall("telegram", method, { ok: res.ok });

  if (res.ok && body !== null && typeof body === "object") {
    const record = body as { ok?: unknown; result?: unknown };
    if (record.ok === true) return { ok: true, result: record.result as T };
  }

  const record =
    body !== null && typeof body === "object"
      ? (body as { description?: unknown; parameters?: { retry_after?: unknown } })
      : {};
  const retryAfter = record.parameters?.retry_after;
  return {
    ok: false,
    error: {
      status: res.status,
      description:
        typeof record.description === "string"
          ? record.description
          : `HTTP ${res.status}`,
      retryAfterMs: typeof retryAfter === "number" ? retryAfter * 1000 : null,
    },
  };
}

/** Одна строка заголовка, пустая строка, затем подробности. */
export function formatTelegramMessage(message: OutgoingMessage): string {
  return [message.title, "", ...message.lines].join("\n").trimEnd();
}

export async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string,
  opts: ChannelSendOptions = {},
): Promise<DeliveryResult> {
  const payload = {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
  };

  let call = await callTelegram<unknown>(token, "sendMessage", payload, opts);

  // Один ретрай при 429 — телеграм сам говорит, сколько ждать. Дольше
  // MAX_RETRY_AFTER_MS не ждём: следующий прогон крона через 15 минут
  // повторит попытку сам, а зависший роут упрётся в maxDuration.
  if (
    !call.ok &&
    call.error?.status === 429 &&
    call.error.retryAfterMs !== null &&
    call.error.retryAfterMs <= MAX_RETRY_AFTER_MS
  ) {
    await new Promise((resolve) => setTimeout(resolve, call.error!.retryAfterMs!));
    call = await callTelegram<unknown>(token, "sendMessage", payload, opts);
  }

  if (call.ok) return { ok: true };

  const error = call.error!;
  return {
    ok: false,
    error: `${error.status}: ${error.description}`,
    ...(isPermanentFailure(error.status, error.description)
      ? { disable: true }
      : {}),
  };
}

export interface TelegramIncoming {
  updateId: number;
  chatId: number;
  /** Имя чата для интерфейса: «@vasya» или «Вася». */
  chatTitle: string | null;
  text: string;
}

export interface TelegramUpdatesResult {
  ok: boolean;
  updates: TelegramIncoming[];
  error?: string;
}

/**
 * Забирает накопившиеся обновления. offset — update_id последнего
 * обработанного плюс один: этим же запросом телеграм считает предыдущие
 * подтверждёнными и больше их не отдаёт.
 *
 * timeout: 0 — короткий опрос: держать соединение в серверлесс-функции,
 * у которой считается каждая секунда, незачем.
 */
export async function getTelegramUpdates(
  token: string,
  offset: number,
  opts: ChannelSendOptions = {},
): Promise<TelegramUpdatesResult> {
  const call = await callTelegram<unknown[]>(
    token,
    "getUpdates",
    { offset, timeout: 0, allowed_updates: ["message"] },
    opts,
  );

  if (!call.ok) {
    const error = call.error!;
    // 409 = у бота установлен вебхук; getUpdates с ним несовместим
    const hint =
      error.status === 409
        ? " (у бота установлен вебхук — снимите его методом deleteWebhook)"
        : "";
    return { ok: false, updates: [], error: `${error.status}: ${error.description}${hint}` };
  }

  const updates: TelegramIncoming[] = [];
  for (const raw of call.result ?? []) {
    const parsed = parseUpdate(raw);
    if (parsed !== null) updates.push(parsed);
  }
  return { ok: true, updates };
}

function parseUpdate(raw: unknown): TelegramIncoming | null {
  if (typeof raw !== "object" || raw === null) return null;
  const update = raw as {
    update_id?: unknown;
    message?: {
      text?: unknown;
      chat?: { id?: unknown; username?: unknown; title?: unknown; first_name?: unknown };
    };
  };
  const updateId = update.update_id;
  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (typeof updateId !== "number") return null;
  if (typeof chatId !== "number" || typeof text !== "string") return null;

  const chat = update.message!.chat!;
  const chatTitle =
    typeof chat.username === "string"
      ? `@${chat.username}`
      : typeof chat.title === "string"
        ? chat.title
        : typeof chat.first_name === "string"
          ? chat.first_name
          : null;

  return { updateId, chatId, chatTitle, text };
}

/**
 * Код привязки из команды `/start`. Телеграм подставляет параметр из ссылки
 * `t.me/bot?start=КОД` в текст сообщения, а в группах команда приходит с
 * суффиксом имени бота (`/start@my_bot КОД`).
 */
export function parseStartCommand(text: string): string | null {
  const match = /^\/start(?:@\S+)?\s+(\S+)\s*$/.exec(text.trim());
  return match ? match[1] : null;
}

export const telegramChannel: NotificationChannel = {
  kind: "telegram",
  async send(config, message, opts) {
    const token = getTelegramToken();
    if (token === null) {
      // Ошибка конфигурации, а не адресата: канал гасить нельзя, иначе
      // забытая переменная окружения тихо отключила бы уведомления всем
      return { ok: false, error: "TELEGRAM_BOT_TOKEN не задан" };
    }
    const chatId = telegramChatId(config);
    if (chatId === null) {
      return { ok: false, error: "Канал не привязан к чату", disable: true };
    }
    return sendTelegramMessage(
      token,
      chatId,
      formatTelegramMessage(message),
      opts,
    );
  },
};
