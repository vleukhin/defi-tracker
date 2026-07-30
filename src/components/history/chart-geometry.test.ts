import { describe, expect, it } from "vitest";
import {
  areaPath,
  bandCenter,
  bandLeft,
  countMissingDays,
  dayNumber,
  hitRegions,
  linePath,
  niceTicks,
  pickTicksByX,
  splitRuns,
  timeScale,
  yPercent,
} from "./chart-geometry";

describe("dayNumber", () => {
  it("считает дни в UTC, без сдвига часовым поясом", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("2026-07-30") - dayNumber("2026-07-25")).toBe(5);
  });
});

describe("splitRuns", () => {
  it("держит подряд идущие дни одним отрезком", () => {
    const runs = splitRuns([
      { takenOn: "2026-07-01" },
      { takenOn: "2026-07-02" },
      { takenOn: "2026-07-03" },
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(3);
  });

  it("рвет серию на пропущенных днях (S3.2)", () => {
    // Дыра в пять дней: 03.07 → 09.07
    const runs = splitRuns([
      { takenOn: "2026-07-01" },
      { takenOn: "2026-07-02" },
      { takenOn: "2026-07-03" },
      { takenOn: "2026-07-09" },
      { takenOn: "2026-07-10" },
    ]);
    expect(runs.map((r) => r.length)).toEqual([3, 2]);
    expect(runs[0].at(-1)!.takenOn).toBe("2026-07-03");
    expect(runs[1][0].takenOn).toBe("2026-07-09");
  });

  it("одиночная точка после разрыва — отдельный отрезок", () => {
    const runs = splitRuns([
      { takenOn: "2026-07-01" },
      { takenOn: "2026-07-20" },
    ]);
    expect(runs.map((r) => r.length)).toEqual([1, 1]);
  });

  it("пустая серия — ноль отрезков", () => {
    expect(splitRuns([])).toEqual([]);
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
    expect(bandLeft(scale, "2026-07-30")).toBe(0);
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

describe("hitRegions", () => {
  it("покрывает всю ширину без нахлестов", () => {
    const regions = hitRegions([10, 50, 90]);
    expect(regions[0]).toEqual({ left: 0, width: 30 });
    expect(regions[1]).toEqual({ left: 30, width: 40 });
    expect(regions[2]).toEqual({ left: 70, width: 30 });
  });

  it("единственная точка забирает всю ширину", () => {
    expect(hitRegions([50])).toEqual([{ left: 0, width: 100 }]);
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

describe("yPercent", () => {
  it("минимум домена — низ, максимум — верх", () => {
    const axis = { min: 100, max: 200, ticks: [100, 150, 200] };
    expect(yPercent(axis, 100)).toBe(100);
    expect(yPercent(axis, 200)).toBe(0);
    expect(yPercent(axis, 150)).toBe(50);
  });
});

describe("pickTicksByX", () => {
  it("разводит подписи минимальным зазором", () => {
    // Точки сгущены слева: равномерный шаг по индексу склеил бы подписи
    const xs = [2, 4, 6, 8, 50, 98];
    const ticks = pickTicksByX(xs, 3, 26);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(xs[ticks[i]] - xs[ticks[i - 1]]).toBeGreaterThanOrEqual(26);
    }
    expect(ticks.at(-1)).toBe(5);
  });

  it("всегда оставляет последнюю подпись", () => {
    expect(pickTicksByX([0, 1, 2], 3, 90).at(-1)).toBe(2);
  });

  it("одна точка — одна подпись", () => {
    expect(pickTicksByX([50], 5, 20)).toEqual([0]);
  });

  it("пустая серия — нет подписей", () => {
    expect(pickTicksByX([], 4, 20)).toEqual([]);
  });
});

describe("linePath / areaPath", () => {
  it("одна точка не дает линии — рисуется маркером", () => {
    expect(linePath([{ x: 50, y: 50 }])).toBe("");
    expect(areaPath([{ x: 50, y: 50 }])).toBe("");
  });

  it("заливка замыкается по низу графика", () => {
    const path = areaPath([
      { x: 0, y: 20 },
      { x: 100, y: 40 },
    ]);
    expect(path).toBe("M0 20 L100 40 L100 100 L0 100 Z");
  });
});
