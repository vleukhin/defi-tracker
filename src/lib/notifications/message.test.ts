import { describe, expect, it } from "vitest";
import type { HfAlertEvent } from "@/lib/alerts/hf";
import { buildHfMessage, buildTestMessage, type HfMessageContext } from "./message";
import { formatTelegramMessage } from "./telegram";

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

function ctx(event: Partial<HfAlertEvent>, over: Partial<HfMessageContext> = {}) {
  return {
    event: {
      kind: "zone-down",
      zone: "below",
      previousZone: "close",
      healthFactor: 1.42,
      previousHf: 1.68,
      checkedAt: "2026-08-03T11:59:00.000Z",
      ...event,
    } as HfAlertEvent,
    chain: "arbitrum",
    walletAddress: WALLET,
    walletLabel: "Основной",
    threshold: 1.5,
    ...over,
  };
}

/** Всё сообщение одной строкой — так его и увидит владелец. */
function text(c: HfMessageContext): string {
  return formatTelegramMessage(buildHfMessage(c));
}

describe("правила записи чисел", () => {
  it("десятичный разделитель — запятая", () => {
    const out = text(ctx({}));
    expect(out).toContain("1,42");
    expect(out).toContain("1,68");
    expect(out).not.toMatch(/\d\.\d/);
  });

  it("минус — символ U+2212, а не дефис", () => {
    const out = text(ctx({ kind: "fast-drop", dropShare: 0.123 }));
    expect(out).toContain("−12,3%");
    expect(out).not.toContain("-12");
  });

  it("нет эмодзи", () => {
    const kinds: HfAlertEvent["kind"][] = [
      "zone-down",
      "zone-up",
      "fast-drop",
      "repeat",
      "stale",
      "stale-recovered",
    ];
    for (const kind of kinds) {
      const out = text(ctx({ kind, staleForMs: 7 * 60 * 60 * 1000 }));
      expect(out, kind).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe("содержание", () => {
  it("называет кошелёк и сеть", () => {
    expect(text(ctx({}))).toContain("Основной (0xd8dA…6045) · Arbitrum");
  });

  it("без метки показывает один адрес", () => {
    expect(text(ctx({}, { walletLabel: null }))).toContain("0xd8dA…6045 · Arbitrum");
  });

  it("показывает было → стало", () => {
    expect(text(ctx({}))).toContain("Было 1,68 → стало 1,42");
  });

  it("на экстренном уровне повторяет меру из стратегии", () => {
    const out = text(ctx({ zone: "urgent", healthFactor: 1.26 }));
    expect(out).toContain("продать часть GM");
    expect(out).toContain("1,50");
  });

  it("в спокойной зоне советов не даёт", () => {
    const out = text(ctx({ kind: "zone-up", zone: "calm", healthFactor: 1.9 }));
    expect(out).not.toContain("продать часть GM");
    expect(out).toContain("восстановился");
  });

  it("погашенный долг — «∞», а не выдуманное число", () => {
    const out = text(
      ctx({ kind: "zone-up", zone: "none", healthFactor: null, previousHf: 1.2 }),
    );
    expect(out).toContain("Долг погашен");
    expect(out).not.toContain("0,00");
  });

  it("слепота называет срок и последнее известное значение", () => {
    const out = text(
      ctx({
        kind: "stale",
        zone: "stale",
        healthFactor: null,
        previousHf: 1.45,
        staleForMs: 7.5 * 60 * 60 * 1000,
      }),
    );
    expect(out).toContain("7 ч назад");
    expect(out).toContain("1,45");
  });

  it("повтор говорит, что состояние прежнее", () => {
    expect(text(ctx({ kind: "repeat", healthFactor: 1.41 }))).toContain(
      "всё ещё 1,41",
    );
  });

  it("критическая зона названа в заголовке", () => {
    const out = text(ctx({ zone: "critical", healthFactor: 1.14 }));
    expect(out.split("\n")[0]).toContain("критический");
  });
});

describe("тестовое сообщение", () => {
  it("честно говорит, что ничего не произошло", () => {
    expect(formatTelegramMessage(buildTestMessage())).toContain(
      "ничего не произошло",
    );
  });
});
