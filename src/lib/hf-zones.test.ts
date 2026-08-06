import { describe, expect, it } from "vitest";
import { hfStatus } from "@/components/debt/hf";
import { hfTone } from "@/components/debt/risk";
import {
  HF_CRITICAL,
  HF_OK_MARGIN,
  HF_URGENT,
  HF_ZONE_RANK,
  hfZone,
  isDangerZone,
} from "./hf-zones";

const T = 1.5;

describe("hfZone", () => {
  it("долга нет — зоны нет", () => {
    expect(hfZone(null, T)).toBe("none");
  });

  it("границы зон при пороге 1,5", () => {
    expect(hfZone(2.4, T)).toBe("calm");
    expect(hfZone(1.8, T)).toBe("calm"); // порог + 0,3 включительно
    expect(hfZone(1.79, T)).toBe("close");
    expect(hfZone(1.5, T)).toBe("close"); // сам порог — ещё не «ниже»
    expect(hfZone(1.49, T)).toBe("below");
    expect(hfZone(1.3, T)).toBe("below");
    expect(hfZone(1.29, T)).toBe("urgent");
    expect(hfZone(1.2, T)).toBe("urgent");
    expect(hfZone(1.19, T)).toBe("critical");
    expect(hfZone(0.98, T)).toBe("critical");
  });

  it("не спотыкается о float: порог + 0,3 не даёт «близко»", () => {
    // 1.5 + 0.3 в float — это 1.8000000000000003
    expect(hfZone(T + HF_OK_MARGIN, T)).toBe("calm");
    expect(hfZone(1.2 + 0.1, T)).toBe("below");
  });

  it("монотонна по HF при любом пороге", () => {
    for (const threshold of [1.05, 1.25, 1.5, 2.5, 9]) {
      const ranks = [3, 2, 1.8, 1.5, 1.35, 1.28, 1.15, 1.01].map(
        (hf) => HF_ZONE_RANK[hfZone(hf, threshold)],
      );
      const sorted = [...ranks].sort((a, b) => a - b);
      expect(ranks, `порог ${threshold}`).toEqual(sorted);
    }
  });

  it("уровни стратегии не зависят от порога пользователя", () => {
    // Порог ниже 1,3 не делает экстренный уровень спокойным
    expect(hfZone(1.25, 1.1)).toBe("urgent");
    expect(hfZone(HF_CRITICAL - 0.01, 1.05)).toBe("critical");
    expect(hfZone(HF_URGENT - 0.01, 1.05)).toBe("urgent");
  });
});

describe("isDangerZone", () => {
  it("опасны зоны от «ниже порога» и ниже", () => {
    expect(["none", "calm", "close"].map((z) => isDangerZone(z as never))).toEqual([
      false,
      false,
      false,
    ]);
    expect(
      ["below", "urgent", "critical"].map((z) => isDangerZone(z as never)),
    ).toEqual([true, true, true]);
  });
});

describe("согласие с экраном", () => {
  it("зона не противоречит статусу индикатора", () => {
    for (const hf of [3, 1.85, 1.8, 1.6, 1.5, 1.42, 1.29, 1.15]) {
      const zone = hfZone(hf, T);
      const status = hfStatus(hf, T);
      if (status === "ok") expect(zone, `HF ${hf}`).toBe("calm");
      if (status === "warning") expect(zone, `HF ${hf}`).toBe("close");
      if (status === "below")
        expect(["below", "urgent", "critical"], `HF ${hf}`).toContain(zone);
    }
  });

  it("зона не противоречит цвету числа", () => {
    for (const hf of [3, 1.6, 1.42, 1.29, 1.15]) {
      const zone = hfZone(hf, T);
      const tone = hfTone(hf, T);
      // Жёлтое — «ниже порога»; красное — экстренный уровень и критично:
      // и то и другое требует действия сегодня (docs/07 §7)
      if (zone === "calm" || zone === "close") expect(tone, `HF ${hf}`).toBe("profit");
      if (zone === "below") expect(tone, `HF ${hf}`).toBe("warn");
      if (zone === "urgent" || zone === "critical")
        expect(tone, `HF ${hf}`).toBe("loss");
    }
  });

  it("экстренный уровень стратегии отличим от «ниже порога»", () => {
    // docs/07 §7: HF < 1,3 — «продать часть GM и поднять HF примерно к 1.5».
    // Пока обе зоны красились жёлтым, это событие ничем не выделялось.
    expect(hfTone(HF_URGENT - 0.01, T)).toBe("loss");
    expect(hfTone(HF_URGENT, T)).toBe("warn");
  });

  it("цвет не зависит от того, какой экран спрашивает", () => {
    // Раньше «Долг» считал по своим границам, «Зоны» и «Настройки» — по
    // hfStatus, а hero «Портфеля» держал 1,2 хардкодом: HF 1,40 при пороге
    // 1,50 был жёлтым на одном экране и красным на соседнем.
    // Единственное правило, из которого теперь выводится цвет на любом
    // экране: он определяется зоной, а зона — общей шкалой.
    for (const threshold of [1.1, 1.5, 2]) {
      for (const hf of [3, 1.85, 1.5, 1.4, 1.25, 1.1, null]) {
        const danger = isDangerZone(hfZone(hf, threshold));
        const tone = hfTone(hf, threshold);
        expect(danger && tone === "profit", `HF ${hf} / ${threshold}`).toBe(
          false,
        );
        expect(!danger && tone === "loss", `HF ${hf} / ${threshold}`).toBe(
          false,
        );
      }
    }
  });
});
