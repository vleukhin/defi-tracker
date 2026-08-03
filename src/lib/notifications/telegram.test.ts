import { describe, expect, it, vi } from "vitest";
import {
  formatTelegramMessage,
  getTelegramUpdates,
  parseStartCommand,
  sendTelegramMessage,
  telegramChatId,
} from "./telegram";

const TOKEN = "123:TEST";
const noopLog = vi.fn(async () => {});

/** Ответ Bot API: {ok:true,result} или ошибка с описанием. */
function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function okFetch() {
  return vi.fn(async () => reply(200, { ok: true, result: { message_id: 1 } }));
}

describe("parseStartCommand", () => {
  it("достаёт код из команды", () => {
    expect(parseStartCommand("/start ABC123")).toBe("ABC123");
  });

  it("понимает команду с именем бота", () => {
    expect(parseStartCommand("/start@defi_tracker_bot ABC123")).toBe("ABC123");
  });

  it("терпит лишние пробелы", () => {
    expect(parseStartCommand("  /start   ABC123  ")).toBe("ABC123");
  });

  it("без кода — не привязка", () => {
    expect(parseStartCommand("/start")).toBeNull();
    expect(parseStartCommand("привет")).toBeNull();
    expect(parseStartCommand("/help ABC123")).toBeNull();
  });
});

describe("telegramChatId", () => {
  it("читает chatId из config", () => {
    expect(telegramChatId({ chatId: 42 })).toBe(42);
  });

  it("непривязанный канал — null, а не ноль", () => {
    expect(telegramChatId({})).toBeNull();
    expect(telegramChatId(null)).toBeNull();
    expect(telegramChatId({ chatId: "42" })).toBeNull();
  });
});

describe("sendTelegramMessage", () => {
  it("шлёт текст в chat_id без предпросмотра ссылок", async () => {
    const fetchFn = okFetch();
    const res = await sendTelegramMessage(TOKEN, 42, "привет", {
      fetchFn: fetchFn as unknown as typeof fetch,
      logCall: noopLog,
    });

    expect(res).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:TEST/sendMessage");
    expect(JSON.parse(init.body as string)).toMatchObject({
      chat_id: 42,
      text: "привет",
      link_preview_options: { is_disabled: true },
    });
  });

  it("заблокировавший бота адресат гасит канал", async () => {
    const fetchFn = vi.fn(async () =>
      reply(403, {
        ok: false,
        description: "Forbidden: bot was blocked by the user",
      }),
    );
    const res = await sendTelegramMessage(TOKEN, 42, "привет", {
      fetchFn: fetchFn as unknown as typeof fetch,
      logCall: noopLog,
    });

    expect(res.ok).toBe(false);
    expect(res.disable).toBe(true);
  });

  it("несуществующий чат гасит канал", async () => {
    const fetchFn = vi.fn(async () =>
      reply(400, { ok: false, description: "Bad Request: chat not found" }),
    );
    const res = await sendTelegramMessage(TOKEN, 42, "привет", {
      fetchFn: fetchFn as unknown as typeof fetch,
      logCall: noopLog,
    });
    expect(res.disable).toBe(true);
  });

  it("сбой на стороне телеграма канал НЕ гасит", async () => {
    const fetchFn = vi.fn(async () =>
      reply(500, { ok: false, description: "Internal Server Error" }),
    );
    const res = await sendTelegramMessage(TOKEN, 42, "привет", {
      fetchFn: fetchFn as unknown as typeof fetch,
      logCall: noopLog,
    });

    expect(res.ok).toBe(false);
    // Временная авария не должна молча отключать предупреждения
    expect(res.disable).toBeUndefined();
  });

  it("обрыв сети канал НЕ гасит", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    const res = await sendTelegramMessage(TOKEN, 42, "привет", {
      fetchFn: fetchFn as unknown as typeof fetch,
      logCall: noopLog,
    });

    expect(res.ok).toBe(false);
    expect(res.disable).toBeUndefined();
    expect(res.error).toContain("network down");
  });

  it("при 429 повторяет один раз", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        reply(429, {
          ok: false,
          description: "Too Many Requests",
          parameters: { retry_after: 0 },
        }),
      )
      .mockResolvedValueOnce(reply(200, { ok: true, result: {} }));

    const res = await sendTelegramMessage(TOKEN, 42, "привет", {
      fetchFn: fetchFn as unknown as typeof fetch,
      logCall: noopLog,
    });

    expect(res).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("длинную паузу не ждёт — повторит следующий прогон", async () => {
    const fetchFn = vi.fn(async () =>
      reply(429, {
        ok: false,
        description: "Too Many Requests",
        parameters: { retry_after: 3600 },
      }),
    );
    const res = await sendTelegramMessage(TOKEN, 42, "привет", {
      fetchFn: fetchFn as unknown as typeof fetch,
      logCall: noopLog,
    });

    expect(res.ok).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("getTelegramUpdates", () => {
  it("разбирает сообщения и подставляет offset", async () => {
    const fetchFn = vi.fn(async () =>
      reply(200, {
        ok: true,
        result: [
          {
            update_id: 10,
            message: {
              text: "/start CODE1",
              chat: { id: 555, username: "vasya" },
            },
          },
        ],
      }),
    );

    const res = await getTelegramUpdates(TOKEN, 7, {
      fetchFn: fetchFn as unknown as typeof fetch,
      logCall: noopLog,
    });

    expect(res.ok).toBe(true);
    expect(res.updates).toEqual([
      { updateId: 10, chatId: 555, chatTitle: "@vasya", text: "/start CODE1" },
    ]);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ offset: 7 });
  });

  it("пропускает обновления без текста, не роняя остальные", async () => {
    const fetchFn = vi.fn(async () =>
      reply(200, {
        ok: true,
        result: [
          { update_id: 1, message: { chat: { id: 1 } } },
          { update_id: 2, edited_message: {} },
          {
            update_id: 3,
            message: { text: "/start X", chat: { id: 9, first_name: "Вася" } },
          },
        ],
      }),
    );

    const res = await getTelegramUpdates(TOKEN, 0, {
      fetchFn: fetchFn as unknown as typeof fetch,
      logCall: noopLog,
    });

    expect(res.updates).toHaveLength(1);
    expect(res.updates[0]).toMatchObject({ chatId: 9, chatTitle: "Вася" });
  });

  it("установленный вебхук объясняется словами", async () => {
    const fetchFn = vi.fn(async () =>
      reply(409, {
        ok: false,
        description: "Conflict: can't use getUpdates method while webhook is active",
      }),
    );

    const res = await getTelegramUpdates(TOKEN, 0, {
      fetchFn: fetchFn as unknown as typeof fetch,
      logCall: noopLog,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain("deleteWebhook");
  });
});

describe("formatTelegramMessage", () => {
  it("заголовок, пустая строка, подробности", () => {
    expect(
      formatTelegramMessage({ title: "Заголовок", lines: ["раз", "два"] }),
    ).toBe("Заголовок\n\nраз\nдва");
  });

  it("сообщение без подробностей не тащит хвост из пустых строк", () => {
    expect(formatTelegramMessage({ title: "Заголовок", lines: [] })).toBe(
      "Заголовок",
    );
  });
});
