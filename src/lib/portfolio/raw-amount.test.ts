import { describe, expect, it } from "vitest";
import { rawToQuantity, toRawBigInt } from "./raw-amount";

describe("toRawBigInt", () => {
  it("обычная целая строка", () => {
    expect(toRawBigInt("1000000000000000000")).toBe(1_000_000_000_000_000_000n);
  });

  it("экспоненциальная запись не роняет BigInt", () => {
    // Так PostgREST отдает numeric(78,0) без каста в text: 1000 токенов
    // с 18 decimals — рядовой баланс, а не крайний случай
    expect(toRawBigInt("1e+21")).toBe(10n ** 21n);
    expect(toRawBigInt("1.5e+21")).toBe(15n * 10n ** 20n);
    expect(toRawBigInt(1e21)).toBe(10n ** 21n);
  });

  it("значение шире Number.MAX_SAFE_INTEGER не теряет точность", () => {
    const raw = "123456789012345678901234567890";
    expect(toRawBigInt(raw).toString()).toBe(raw);
  });

  it("мусор и пустота — ноль, а не NaN и не исключение", () => {
    for (const bad of ["", "  ", "abc", "0x10", null, undefined, "1.5"]) {
      expect(toRawBigInt(bad)).toBe(0n);
    }
  });
});

describe("rawToQuantity", () => {
  it("делит на decimals и убирает хвостовые нули", () => {
    expect(rawToQuantity("1000000000000000000", 18)).toBe("1");
    expect(rawToQuantity("1500000000000000000", 18)).toBe("1.5");
    // USDC = 6, WBTC = 8: предполагать 18 нельзя
    expect(rawToQuantity("20000000000", 6)).toBe("20000");
    expect(rawToQuantity("150000000", 8)).toBe("1.5");
  });

  it("значение меньше единицы получает ведущий ноль", () => {
    expect(rawToQuantity("1", 18)).toBe("0.000000000000000001");
    expect(rawToQuantity("100000000000000", 18)).toBe("0.0001");
  });

  it("decimals = 0 отдает целое", () => {
    expect(rawToQuantity("42", 0)).toBe("42");
  });

  it("ноль остается нулем, а не пустой строкой", () => {
    expect(rawToQuantity("0", 18)).toBe("0");
  });

  it("невалидные decimals не дают мусора в стоимости", () => {
    expect(rawToQuantity("1000", -1)).toBe("0");
    expect(rawToQuantity("1000", 1.5)).toBe("0");
  });
});
