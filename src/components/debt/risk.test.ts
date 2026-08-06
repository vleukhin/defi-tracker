import { describe, expect, it } from "vitest";
import {
  SAFETY_DANGER_PERCENT,
  SAFETY_LIQUIDATION_PERCENT,
  ltvRebalance,
  safetyPosition,
} from "./risk";

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

describe("safetyPosition", () => {
  const T = 1.5;

  it("маркер не может противоречить числу", () => {
    // Свойство, ради которого шкала аффинная: левее красной границы —
    // ровно тогда, когда HF ниже единицы, левее жёлтой — когда ниже порога
    expect(safetyPosition(1, T)).toBeCloseTo(SAFETY_LIQUIDATION_PERCENT, 6);
    expect(safetyPosition(T, T)).toBeCloseTo(SAFETY_DANGER_PERCENT, 6);
    expect(safetyPosition(0.9, T)).toBeLessThan(SAFETY_LIQUIDATION_PERCENT);
    expect(safetyPosition(1.4, T)).toBeLessThan(SAFETY_DANGER_PERCENT);
    expect(safetyPosition(1.6, T)).toBeGreaterThan(SAFETY_DANGER_PERCENT);
  });

  it("растёт по HF и не выходит за полосу", () => {
    let prev = -1;
    for (const hf of [0, 0.5, 1, 1.2, 1.5, 1.8, 2.5, 10, 1e6]) {
      const p = safetyPosition(hf, T);
      expect(p, `HF ${hf}`).toBeGreaterThanOrEqual(prev);
      expect(p, `HF ${hf}`).toBeGreaterThanOrEqual(0);
      expect(p, `HF ${hf}`).toBeLessThanOrEqual(100);
      prev = p;
    }
  });

  it("порог вплотную к единице не роняет шкалу в деление на ноль", () => {
    expect(Number.isFinite(safetyPosition(1.4, 1))).toBe(true);
    expect(Number.isFinite(safetyPosition(1.4, 0.5))).toBe(true);
  });

  it("единственный источник позиции маркера на всех экранах", () => {
    // Регрессия: карточка займа в «Зонах» считала позицию собственной
    // кусочно-линейной шкалой с участком до HF = 2. Ниже порога обе
    // совпадали, выше расходились — при HF 1,68 и пороге 1,50 маркер
    // стоял на 63% против 49%, и запас «вырастал» на четверть полосы
    // при переходе с «Долга» в «Зоны».
    const hfPercentRemoved = 42 + ((1.68 - 1.5) / (2 - 1.5)) * (100 - 42);
    expect(safetyPosition(1.68, 1.5)).not.toBeCloseTo(hfPercentRemoved, 1);
    expect(safetyPosition(1.68, 1.5)).toBeCloseTo(49.2, 1);
  });
});
