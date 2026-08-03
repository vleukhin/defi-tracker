import { describe, expect, it } from "vitest";
import { symbolCategory } from "./symbol-category";

describe("symbolCategory", () => {
  it("узнаёт базовые активы и стейблы", () => {
    expect(symbolCategory("BTC")).toBe("btc");
    expect(symbolCategory("WBTC")).toBe("btc");
    expect(symbolCategory("weth")).toBe("eth");
    expect(symbolCategory("USDC")).toBe("stable");
  });

  /**
   * Мостовые токены пишутся суффиксом, и без них рынок BTC/USD у GMX
   * (long-нога — WBTC.b) считался «не BTC»: пул терял цель 70% и получал
   * подпись «рынок вне двух базовых активов» — утверждение, обратное правде.
   */
  it("узнаёт мостовые варианты базовых активов", () => {
    expect(symbolCategory("WBTC.b")).toBe("btc");
    expect(symbolCategory("WBTC.e")).toBe("btc");
    expect(symbolCategory("WETH.e")).toBe("eth");
    expect(symbolCategory("USDC.e")).toBe("stable");
  });

  it("токен вне трёх категорий категорией не считается", () => {
    // null ≠ «стейбл»: покрасить неизвестный токен категорийным цветом
    // значило бы соврать о составе позиции
    expect(symbolCategory("ARB")).toBeNull();
    expect(symbolCategory("GMX")).toBeNull();
  });
});
