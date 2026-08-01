import { describe, expect, it } from "vitest";
import { buildStableBorrow } from "./borrow-rate";

/**
 * Стоимость заемных стейблов. Число нужно как порог: депозит на стороннем
 * лендинге держат, только пока его ставка выше ставки по займу (docs/07 §3),
 * поэтому важно, чтобы среднее не перекашивало мелким резервом.
 */
describe("buildStableBorrow", () => {
  it("среднее взвешено по долгу, а не по числу резервов", () => {
    const res = buildStableBorrow([
      { chain: "arbitrum", symbol: "USDCn", debtUsd: 30_000, ratePercent: 6 },
      { chain: "arbitrum", symbol: "USDT", debtUsd: 1_000, ratePercent: 12 },
    ]);
    // Простое среднее дало бы 9% и вывод «депозит под 7% невыгоден»
    expect(res.ratePercent).toBeCloseTo((6 * 30_000 + 12 * 1_000) / 31_000, 9);
    expect(res.debtUsd).toBe(31_000);
  });

  it("резерв без ставки в среднее не входит, но в долг входит", () => {
    const res = buildStableBorrow([
      { chain: "ethereum", symbol: "USDC", debtUsd: 10_000, ratePercent: 5 },
      { chain: "base", symbol: "USDbC", debtUsd: 5_000, ratePercent: null },
    ]);
    expect(res.ratePercent).toBeCloseTo(5, 9);
    expect(res.debtUsd).toBe(15_000);
  });

  it("ставок нет вовсе -> null, а не ноль", () => {
    const res = buildStableBorrow([
      { chain: "base", symbol: "USDC", debtUsd: 1_000, ratePercent: null },
    ]);
    expect(res.ratePercent).toBeNull();
    expect(res.debtUsd).toBe(1_000);
  });

  it("нулевой долг отбрасывается: закрытый заем ставку не задает", () => {
    const res = buildStableBorrow([
      { chain: "base", symbol: "USDC", debtUsd: 0, ratePercent: 9 },
    ]);
    expect(res.ratePercent).toBeNull();
    expect(res.debtUsd).toBe(0);
    expect(res.reserves).toEqual([]);
  });

  it("разбивка отсортирована по размеру долга", () => {
    const res = buildStableBorrow([
      { chain: "base", symbol: "USDC", debtUsd: 100, ratePercent: 4 },
      { chain: "arbitrum", symbol: "USDCn", debtUsd: 900, ratePercent: 6 },
    ]);
    expect(res.reserves.map((r) => r.symbol)).toEqual(["USDCn", "USDC"]);
  });
});
