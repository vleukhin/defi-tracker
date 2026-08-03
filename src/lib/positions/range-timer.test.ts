import { describe, expect, it } from "vitest";
import { rangeDecision } from "./range-timer";

/**
 * Правило 48 часов. Ошибка в любую сторону дорога: раньше срока стратегия
 * действовать запрещает, а «навсегда рано» лишило бы правило смысла.
 */
describe("rangeDecision", () => {
  // Среда, 29.07.2026, 10:00 UTC
  const wed = "2026-07-29T10:00:00.000Z";

  it("до 48 часов действовать рано", () => {
    const d = rangeDecision(wed, Date.parse("2026-07-30T10:00:00.000Z"))!;
    expect(d.hoursElapsed).toBeCloseTo(24, 6);
    expect(d.hoursLeft).toBeCloseTo(24, 6);
    expect(d.ready).toBe(false);
    expect(d.readyAtIso).toBe("2026-07-31T10:00:00.000Z");
    expect(d.postponedToMonday).toBe(false);
  });

  it("48 часов прошли — можно принимать решение", () => {
    const d = rangeDecision(wed, Date.parse("2026-07-31T10:00:01.000Z"))!;
    expect(d.ready).toBe(true);
  });

  it("срок выпал на субботу — ждем до понедельника", () => {
    // Четверг 30.07 + 48 ч = суббота 01.08
    const thu = "2026-07-30T12:00:00.000Z";
    const d = rangeDecision(thu, Date.parse("2026-08-01T13:00:00.000Z"))!;
    expect(d.postponedToMonday).toBe(true);
    expect(d.readyAtIso).toBe("2026-08-03T00:00:00.000Z");
    expect(d.ready).toBe(false);
    // 48 часов формально прошли, но ждать до понедельника еще 35 часов —
    // «48 минус прошедшие» дало бы минус одиннадцать
    expect(d.hoursElapsed).toBeGreaterThan(48);
    expect(d.hoursLeft).toBeCloseTo(35, 6);
  });

  it("срок выпал на воскресенье — тоже понедельник", () => {
    // Пятница 31.07 + 48 ч = воскресенье 02.08
    const fri = "2026-07-31T09:00:00.000Z";
    const d = rangeDecision(fri, Date.parse("2026-08-02T23:00:00.000Z"))!;
    expect(d.readyAtIso).toBe("2026-08-03T00:00:00.000Z");
    expect(d.ready).toBe(false);
  });

  it("в понедельник после сдвига действовать можно", () => {
    const thu = "2026-07-30T12:00:00.000Z";
    const d = rangeDecision(thu, Date.parse("2026-08-03T00:00:00.000Z"))!;
    expect(d.ready).toBe(true);
    expect(d.hoursLeft).toBe(0);
  });

  it("мусор вместо даты -> null, а не NaN на экране", () => {
    expect(rangeDecision("не дата", Date.now())).toBeNull();
  });
});
