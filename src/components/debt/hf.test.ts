import { describe, expect, it } from "vitest";
import {
  formatHf,
  formatHfThreshold,
  hfStatus,
  hfTitle,
} from "./hf";

describe("hfStatus", () => {
  it("null (долга нет) — none", () => {
    expect(hfStatus(null, 1.5)).toBe("none");
  });

  it("ниже порога — below", () => {
    expect(hfStatus(1.31, 1.5)).toBe("below");
    expect(hfStatus(0.99, 1.5)).toBe("below");
  });

  it("ровно порог — уже не below, а warning", () => {
    expect(hfStatus(1.5, 1.5)).toBe("warning");
  });

  it("в буфере [порог; порог + 0.3) — warning", () => {
    expect(hfStatus(1.62, 1.5)).toBe("warning");
    expect(hfStatus(1.79, 1.5)).toBe("warning");
  });

  it("ровно порог + 0.3 — ok (float-допуск не съедает границу)", () => {
    expect(hfStatus(1.8, 1.5)).toBe("ok");
    // 1.2 + 0.3 = 1.5000000000000002 в float — HF 1.5 обязан быть ok
    expect(hfStatus(1.5, 1.2)).toBe("ok");
  });

  it("с запасом — ok", () => {
    expect(hfStatus(2.4, 1.5)).toBe("ok");
  });
});

describe("formatHf", () => {
  it("null — «∞», без переполнения числового поля", () => {
    expect(formatHf(null)).toBe("∞");
  });

  it("два знака с запятой", () => {
    expect(formatHf(1.7431)).toBe("1,74");
    expect(formatHf(12)).toBe("12,00");
  });
});

describe("formatHfThreshold", () => {
  it("хвостовые нули срезаются", () => {
    expect(formatHfThreshold(1.5)).toBe("1,5");
    expect(formatHfThreshold(2)).toBe("2");
  });

  it("значимые знаки сохраняются", () => {
    expect(formatHfThreshold(1.75)).toBe("1,75");
  });
});

describe("hfTitle", () => {
  it("словами, не только цветом", () => {
    expect(hfTitle("below", 1.5)).toContain("риск ликвидации");
    expect(hfTitle("warning", 1.5)).toContain("близок к порогу 1,5");
    expect(hfTitle("ok", 1.5)).toContain("выше порога");
    expect(hfTitle("none", 1.5)).toContain("Долга нет");
  });
});
