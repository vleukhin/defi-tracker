import { describe, expect, it } from "vitest";
import { ltvRebalance } from "./risk";

describe("ltvRebalance", () => {
  it("ниже цели — можно взять ещё", () => {
    // залог 110 902, долг 52 336 -> LTV 47,2%; цель 50% -> долг 55 451
    const r = ltvRebalance(110_902, 52_336, 50);
    expect(r?.action).toBe("borrow");
    expect(r?.targetDebtUsd).toBeCloseTo(55_451, 2);
    expect(r?.deltaUsd).toBeCloseTo(3115, 2);
  });

  it("выше цели — нужно погасить", () => {
    const r = ltvRebalance(100_000, 60_000, 50);
    expect(r?.action).toBe("repay");
    expect(r?.deltaUsd).toBeCloseTo(-10_000, 6);
  });

  it("копеечное расхождение — это дрожание цен, а не задача", () => {
    const r = ltvRebalance(100_000, 50_000.005, 50);
    expect(r?.action).toBe("on-target");
  });

  it("без залога LTV не определён", () => {
    expect(ltvRebalance(0, 1000, 50)).toBeNull();
    expect(ltvRebalance(null, 1000, 50)).toBeNull();
    expect(ltvRebalance(100_000, null, 50)).toBeNull();
  });

  it("долга нет — цель означает «взять на всю цель»", () => {
    const r = ltvRebalance(100_000, 0, 50);
    expect(r?.action).toBe("borrow");
    expect(r?.deltaUsd).toBeCloseTo(50_000, 6);
  });
});
