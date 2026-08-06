import { describe, expect, it } from "vitest";
import type { SnapshotDto } from "@/lib/api/types";
import {
  hfSeries,
  ltvSeries,
  riskChange,
  worstValue,
} from "./risk-series";

interface Point {
  debtUsd?: number | null;
  collateralUsd?: number | null;
  healthFactor?: number | null;
  isPartial?: boolean;
}

function snapshot(takenOn: string, point: Point = {}): SnapshotDto {
  return {
    id: takenOn,
    takenOn,
    takenAt: `${takenOn}T03:00:00.000Z`,
    totalUsd: 150_000,
    debtUsd: point.debtUsd === undefined ? 50_000 : point.debtUsd,
    collateralUsd:
      point.collateralUsd === undefined ? 100_000 : point.collateralUsd,
    healthFactor: point.healthFactor === undefined ? 1.8 : point.healthFactor,
    positionsUsd: 0,
    freeUsd: 0,
    freeBorrowedUsd: 0,
    isPartial: point.isPartial ?? false,
    items: [],
  };
}

describe("hfSeries", () => {
  it("берет health factor как есть — он уже минимум по кошелькам и сетям", () => {
    const points = hfSeries([
      snapshot("2026-08-01", { healthFactor: 1.8 }),
      snapshot("2026-08-02", { healthFactor: 1.42 }),
    ]);
    expect(points.map((p) => p.value)).toEqual([1.8, 1.42]);
  });

  it("день без HF выпадает из серии, а не рисуется нулем", () => {
    // Ноль на оси HF означал бы «ликвидация уже произошла»
    const points = hfSeries([
      snapshot("2026-08-01", { healthFactor: null, debtUsd: null }),
      snapshot("2026-08-02"),
    ]);
    expect(points.map((p) => p.takenOn)).toEqual(["2026-08-02"]);
  });

  it("день без долга («∞») в серию тоже не попадает", () => {
    // Бесконечность на оси не изображается; в LTV этот же день войдет нулем
    const points = hfSeries([snapshot("2026-08-01", { healthFactor: null, debtUsd: 0 })]);
    expect(points).toEqual([]);
  });

  it("частичность точки переносится в серию", () => {
    const [point] = hfSeries([snapshot("2026-08-01", { isPartial: true })]);
    expect(point.isPartial).toBe(true);
  });
});

describe("ltvSeries", () => {
  it("считает долг к залогу в процентах", () => {
    const [point] = ltvSeries([
      snapshot("2026-08-01", { debtUsd: 50_000, collateralUsd: 100_000 }),
    ]);
    expect(point.value).toBe(50);
  });

  it("день без долга дает честный ноль: залог известен, долга нет", () => {
    const [point] = ltvSeries([
      snapshot("2026-08-01", { debtUsd: 0, healthFactor: null }),
    ]);
    expect(point.value).toBe(0);
  });

  it("залог не читался — точки нет, а не деления на ноль", () => {
    expect(ltvSeries([snapshot("2026-08-01", { collateralUsd: null })])).toEqual(
      [],
    );
    expect(ltvSeries([snapshot("2026-08-01", { collateralUsd: 0 })])).toEqual([]);
  });

  it("долг не читался — точки нет", () => {
    expect(ltvSeries([snapshot("2026-08-01", { debtUsd: null })])).toEqual([]);
  });

  it("старый снепшот без обеих колонок в серию не попадает", () => {
    const points = ltvSeries([
      snapshot("2026-08-01", { debtUsd: null, collateralUsd: null }),
      snapshot("2026-08-02"),
    ]);
    expect(points.map((p) => p.takenOn)).toEqual(["2026-08-02"]);
  });
});

describe("riskChange и worstValue", () => {
  it("изменение считается по первой и последней посчитанной точке", () => {
    const points = hfSeries([
      snapshot("2026-08-01", { healthFactor: 1.8 }),
      snapshot("2026-08-02", { healthFactor: null, debtUsd: null }),
      snapshot("2026-08-03", { healthFactor: 1.5 }),
    ]);
    const change = riskChange(points)!;
    expect(change.from).toBe(1.8);
    expect(change.to).toBe(1.5);
    // Разность float'ов: сравниваем с допуском, а не побитово
    expect(change.abs).toBeCloseTo(-0.3, 10);
  });

  it("одна точка изменения не дает", () => {
    expect(riskChange(hfSeries([snapshot("2026-08-01")]))).toBeNull();
  });

  it("худшее за период: у HF минимум, у LTV максимум", () => {
    // У метрики риска интересна та сторона, с которой приходит ликвидация
    const snapshots = [
      snapshot("2026-08-01", { healthFactor: 1.8, debtUsd: 40_000 }),
      snapshot("2026-08-02", { healthFactor: 1.35, debtUsd: 62_000 }),
      snapshot("2026-08-03", { healthFactor: 1.6, debtUsd: 50_000 }),
    ];
    expect(worstValue(hfSeries(snapshots), "hf")).toBe(1.35);
    expect(worstValue(ltvSeries(snapshots), "ltv")).toBe(62);
  });

  it("пустая серия худшего значения не имеет", () => {
    expect(worstValue([], "hf")).toBeNull();
  });
});
