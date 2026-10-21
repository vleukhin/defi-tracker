import { describe, expect, it } from "vitest";
import { MATURITY_SOON_DAYS, maturityDecision, maturityProgress } from "./maturity";

const EXPIRY = "2026-11-26T00:00:00.000Z";
const at = (iso: string) => Date.parse(iso);

describe("погашение Pendle", () => {
  it("до срока дни считаются вверх: неполный день — это день", () => {
    const d = maturityDecision(EXPIRY, at("2026-11-25T16:00:00.000Z"))!;
    expect(d).toEqual({ daysLeft: 1, daysSince: 0, matured: false, soon: true });
  });

  it("за пределами недели — срок есть, но не скоро", () => {
    const d = maturityDecision(EXPIRY, at("2026-10-19T00:00:00.000Z"))!;
    expect(d.daysLeft).toBe(38);
    expect(d.soon).toBe(false);
  });

  it(`ровно ${MATURITY_SOON_DAYS} дней — уже «скоро»`, () => {
    const d = maturityDecision(EXPIRY, at("2026-11-19T00:00:00.000Z"))!;
    expect(d.daysLeft).toBe(MATURITY_SOON_DAYS);
    expect(d.soon).toBe(true);
  });

  it("в момент погашения токен уже погашен", () => {
    const d = maturityDecision(EXPIRY, at(EXPIRY))!;
    expect(d).toEqual({ daysLeft: 0, daysSince: 0, matured: true, soon: false });
  });

  it("после погашения считаются прошедшие дни", () => {
    const d = maturityDecision(EXPIRY, at("2026-12-01T12:00:00.000Z"))!;
    expect(d.matured).toBe(true);
    expect(d.daysSince).toBe(5);
  });

  it("мусор вместо даты — нет решения, а не «погашено»", () => {
    expect(maturityDecision("скоро", 0)).toBeNull();
  });
});

describe("шкала срока до погашения", () => {
  const START = "2026-08-08T00:00:00.000Z";
  const END = "2027-01-14T00:00:00.000Z"; // 159 дней

  it("доля пройденного срока считается от начала шкалы", () => {
    const p = maturityProgress(START, END, at("2026-10-21T00:00:00.000Z"))!;
    expect(p.totalDays).toBe(159);
    expect(p.elapsedDays).toBe(74);
    expect(p.fraction).toBeCloseTo(74 / 159, 9);
  });

  it("после погашения шкала заполнена, дни не растут дальше срока", () => {
    const p = maturityProgress(START, END, at("2027-03-01T00:00:00.000Z"))!;
    expect(p.fraction).toBe(1);
    expect(p.elapsedDays).toBe(159);
  });

  it("до начала — ноль, а не отрицательная доля", () => {
    expect(maturityProgress(START, END, at("2026-08-01T00:00:00.000Z"))!.fraction).toBe(0);
  });

  it("начало неизвестно или после конца — шкалы нет", () => {
    expect(maturityProgress(null, END, 0)).toBeNull();
    expect(maturityProgress(END, START, 0)).toBeNull();
  });
});
