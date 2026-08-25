import { describe, expect, it } from "vitest";
import {
  bandCenter,
  countMissingDays,
  dateFromDay,
  dayNumber,
  denseDays,
  niceTicks,
  signGradientOffset,
  timeScale,
} from "./chart-geometry";

describe("dayNumber", () => {
  it("считает дни в UTC, без сдвига часовым поясом", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("2026-07-30") - dayNumber("2026-07-25")).toBe(5);
  });
});

describe("countMissingDays", () => {
  it("считает дни без снепшота между точками", () => {
    expect(
      countMissingDays([
        { takenOn: "2026-07-01" },
        { takenOn: "2026-07-02" },
        { takenOn: "2026-07-08" },
      ]),
    ).toBe(5);
  });

  it("сплошная серия — ни одного пропуска", () => {
    expect(
      countMissingDays([{ takenOn: "2026-07-01" }, { takenOn: "2026-07-02" }]),
    ).toBe(0);
  });
});

describe("timeScale / bandCenter", () => {
  it("одна точка занимает весь график и стоит по центру", () => {
    const scale = timeScale([{ takenOn: "2026-07-30" }])!;
    expect(scale.span).toBe(1);
    expect(scale.slot).toBe(100);
    expect(bandCenter(scale, "2026-07-30")).toBe(50);
  });

  it("позиция определяется календарем, а не номером точки", () => {
    // Три точки, но период — 11 дней: середина серии стоит не по центру
    const points = [
      { takenOn: "2026-07-01" },
      { takenOn: "2026-07-02" },
      { takenOn: "2026-07-11" },
    ];
    const scale = timeScale(points)!;
    expect(scale.span).toBe(11);
    expect(bandCenter(scale, "2026-07-01")).toBeCloseTo(4.545, 3);
    expect(bandCenter(scale, "2026-07-02")).toBeCloseTo(13.636, 3);
    expect(bandCenter(scale, "2026-07-11")).toBeCloseTo(95.455, 3);
  });

  it("пустая серия — шкалы нет", () => {
    expect(timeScale([])).toBeNull();
  });
});

describe("niceTicks", () => {
  it("дает круглые подписи вокруг диапазона", () => {
    const axis = niceTicks(151_200, 154_800);
    expect(axis.min).toBeLessThanOrEqual(151_200);
    expect(axis.max).toBeGreaterThanOrEqual(154_800);
    expect(axis.ticks.length).toBeGreaterThanOrEqual(3);
    expect(axis.ticks.length).toBeLessThanOrEqual(6);
    expect(axis.ticks[0]).toBe(axis.min);
    expect(axis.ticks.at(-1)).toBe(axis.max);
  });

  it("плоская серия не схлопывает домен в точку", () => {
    const axis = niceTicks(1000, 1000);
    expect(axis.max).toBeGreaterThan(axis.min);
  });

  it("не разводит подписи хвостами плавающей точки", () => {
    for (const tick of niceTicks(0.1, 0.9).ticks) {
      expect(String(tick).length).toBeLessThan(8);
    }
  });
});

describe("dateFromDay", () => {
  it("обратно к dayNumber", () => {
    for (const date of ["1970-01-01", "2026-07-30", "2026-01-01", "2024-02-29"]) {
      expect(dateFromDay(dayNumber(date))).toBe(date);
    }
  });
});

describe("denseDays", () => {
  it("отдает строку на каждый календарный день периода", () => {
    const days = denseDays([
      { takenOn: "2026-07-01" },
      { takenOn: "2026-07-02" },
      { takenOn: "2026-07-03" },
    ]);
    expect(days.map((d) => d.takenOn)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
    expect(days.every((d) => d.point !== null)).toBe(true);
  });

  it("день без снепшота получает null — это и есть разрыв", () => {
    const days = denseDays([
      { takenOn: "2026-07-01" },
      { takenOn: "2026-07-04" },
    ]);
    expect(days).toHaveLength(4);
    expect(days.map((d) => d.point === null)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it("пустых дней ровно столько, сколько насчитал countMissingDays", () => {
    const points = [
      { takenOn: "2026-07-01" },
      { takenOn: "2026-07-02" },
      { takenOn: "2026-07-09" },
      { takenOn: "2026-07-10" },
      { takenOn: "2026-07-20" },
    ];
    const empty = denseDays(points).filter((d) => d.point === null).length;
    expect(empty).toBe(countMissingDays(points));
  });

  it("сохраняет исходную точку, а не только дату", () => {
    const days = denseDays([{ takenOn: "2026-07-01", totalUsd: 12 }]);
    expect(days[0].point?.totalUsd).toBe(12);
  });

  it("пустая серия — ноль дней", () => {
    expect(denseDays([])).toEqual([]);
  });
});

describe("signGradientOffset", () => {
  it("ставит стык ровно на ноль по РАЗМАХУ ЗНАЧЕНИЙ, а не по домену оси", () => {
    // +3000 сверху, −1000 снизу: ноль на 3/4 высоты пути
    expect(signGradientOffset([3000, -1000])).toBeCloseTo(0.75, 6);
    expect(signGradientOffset([1000, -1000])).toBeCloseTo(0.5, 6);
    expect(signGradientOffset([1000, -3000])).toBeCloseTo(0.25, 6);
  });

  it("ряд целиком выше нуля — один цвет: заливка всё равно висит от нуля", () => {
    expect(signGradientOffset([500, 1500, 900])).toBe(1);
  });

  it("ряд целиком ниже нуля — один цвет", () => {
    expect(signGradientOffset([-500, -1500, -900])).toBe(0);
  });

  it("плоский нулевой ряд не делит на ноль", () => {
    expect(signGradientOffset([0, 0])).toBe(0.5);
    expect(signGradientOffset([])).toBe(0.5);
  });

  it("разрывы ряда в расчёт не идут", () => {
    expect(signGradientOffset([3000, null, -1000])).toBeCloseTo(0.75, 6);
  });
});
