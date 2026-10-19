import { describe, expect, it } from "vitest";
import { MATURITY_SOON_DAYS, maturityDecision } from "./maturity";

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
