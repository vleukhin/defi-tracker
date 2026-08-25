import { describe, expect, it } from "vitest";
import type { SnapshotDto, SnapshotItemDto } from "@/lib/api/types";
import { denseDays, niceTicks } from "./chart-geometry";
import { periodChange, quantitySeries, tickDecimals } from "./quantity-series";

/** Снепшот с количествами по категориям; null = цены в тот день не было. */
interface Quantities {
  btc?: number | null;
  eth?: number | null;
  stable?: number | null;
}

function snapshot(
  takenOn: string,
  quantities: Quantities,
  isPartial = false,
): SnapshotDto {
  const item = (
    category: SnapshotItemDto["category"],
    quantity: number | null | undefined,
  ): SnapshotItemDto => ({
    category,
    quantity: quantity ?? null,
    composition: { collateral: [], manual: [] },
    priceUsd: quantity == null ? null : 1,
    valueUsd: quantity ?? 0,
    percent: 0,
    collateralUsd: 0,
    manualUsd: 0,
    freeUsd: 0,
  });
  return {
    id: takenOn,
    takenOn,
    takenAt: `${takenOn}T03:00:00.000Z`,
    totalUsd: 0,
    debtUsd: null,
    collateralUsd: null,
    healthFactor: null,
    positionsUsd: null,
    freeUsd: null,
    freeBorrowedUsd: null,
    isPartial,
    items: [
      item("btc", quantities.btc),
      item("eth", quantities.eth),
      item("stable", quantities.stable),
    ],
  };
}

describe("quantitySeries", () => {
  it("берет количество своей категории в порядке снепшотов", () => {
    const series = quantitySeries(
      [
        snapshot("2026-07-01", { btc: 1.2, eth: 16.5 }),
        snapshot("2026-07-02", { btc: 1.26, eth: 16.9 }),
      ],
      "btc",
    );
    expect(series.map((p) => p.quantity)).toEqual([1.2, 1.26]);
    expect(series.map((p) => p.takenOn)).toEqual(["2026-07-01", "2026-07-02"]);
  });

  it("выбрасывает день без количества, а не превращает его в ноль", () => {
    // null = цены не было; ноль означал бы «всё продано»
    const series = quantitySeries(
      [
        snapshot("2026-07-01", { btc: 1.2 }),
        snapshot("2026-07-02", { btc: null }),
        snapshot("2026-07-03", { btc: 1.3 }),
      ],
      "btc",
    );
    expect(series.map((p) => p.quantity)).toEqual([1.2, 1.3]);
    expect(series.some((p) => p.quantity === 0)).toBe(false);
  });

  it("день без количества рвет линию, как пропущенный день (S3.2)", () => {
    // Проверяем связку с геометрией: после фильтрации 02.07 в ряду
    // становится дырой, и линия через него не пойдет
    const series = quantitySeries(
      [
        snapshot("2026-07-01", { btc: 1.2 }),
        snapshot("2026-07-02", { btc: null }),
        snapshot("2026-07-03", { btc: 1.3 }),
      ],
      "btc",
    );
    expect(denseDays(series).map((d) => d.point !== null)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("подряд идущие дни с количеством остаются без разрывов", () => {
    const series = quantitySeries(
      [
        snapshot("2026-07-01", { btc: 1.2 }),
        snapshot("2026-07-02", { btc: 1.25 }),
        snapshot("2026-07-03", { btc: 1.3 }),
      ],
      "btc",
    );
    expect(denseDays(series).every((d) => d.point !== null)).toBe(true);
  });

  it("категория без количеств вообще — пустая серия", () => {
    const series = quantitySeries(
      [
        snapshot("2026-07-01", { stable: null }),
        snapshot("2026-07-02", { stable: null }),
      ],
      "stable",
    );
    expect(series).toEqual([]);
  });

  it("отсутствие категории в составе — не ноль, а пропуск точки", () => {
    const partial = snapshot("2026-07-01", { btc: 1.2 });
    partial.items = partial.items.filter((i) => i.category !== "eth");
    expect(quantitySeries([partial], "eth")).toEqual([]);
  });

  it("переносит пометку частичного снепшота на точку", () => {
    const series = quantitySeries(
      [snapshot("2026-07-01", { btc: 1.2 }, true)],
      "btc",
    );
    expect(series[0].isPartial).toBe(true);
  });

  it("ноль — настоящее измерение и в серии остается", () => {
    const series = quantitySeries([snapshot("2026-07-01", { btc: 0 })], "btc");
    expect(series).toHaveLength(1);
    expect(series[0].quantity).toBe(0);
  });
});

describe("periodChange", () => {
  it("считает изменение первой и последней точки", () => {
    const change = periodChange([
      { takenOn: "2026-07-01", quantity: 1, isPartial: false },
      { takenOn: "2026-07-02", quantity: 1.5, isPartial: false },
    ])!;
    expect(change.from).toBe(1);
    expect(change.to).toBe(1.5);
    expect(change.abs).toBeCloseTo(0.5, 10);
    expect(change.pct).toBeCloseTo(50, 10);
  });

  it("ведущие и хвостовые null не участвуют в изменении", () => {
    // Серия уже отфильтрована quantitySeries: крайние дни без количества
    // не должны становиться точками отсчета
    const snapshots = [
      snapshot("2026-07-01", { btc: null }),
      snapshot("2026-07-02", { btc: 1 }),
      snapshot("2026-07-03", { btc: 2 }),
      snapshot("2026-07-04", { btc: null }),
    ];
    const change = periodChange(quantitySeries(snapshots, "btc"))!;
    expect(change.from).toBe(1);
    expect(change.to).toBe(2);
    expect(change.abs).toBe(1);
    expect(change.pct).toBe(100);
  });

  it("падение количества дает отрицательное изменение", () => {
    const change = periodChange([
      { takenOn: "2026-07-01", quantity: 2, isPartial: false },
      { takenOn: "2026-07-02", quantity: 1.5, isPartial: false },
    ])!;
    expect(change.abs).toBeCloseTo(-0.5, 10);
    expect(change.pct).toBeCloseTo(-25, 10);
  });

  it("старт с нуля — процента нет, абсолютное изменение есть", () => {
    const change = periodChange([
      { takenOn: "2026-07-01", quantity: 0, isPartial: false },
      { takenOn: "2026-07-02", quantity: 0.5, isPartial: false },
    ])!;
    expect(change.pct).toBeNull();
    expect(change.abs).toBe(0.5);
  });

  it("одной точки для изменения мало", () => {
    expect(
      periodChange([{ takenOn: "2026-07-01", quantity: 1, isPartial: false }]),
    ).toBeNull();
    expect(periodChange([])).toBeNull();
  });
});

describe("tickDecimals", () => {
  it("не опускается ниже точности категории", () => {
    expect(tickDecimals(niceTicks(1.2, 1.3), 4)).toBe(4);
    expect(tickDecimals(niceTicks(30_000, 40_000), 0)).toBe(0);
  });

  it("добирает знаки, когда шаг сетки мельче точности категории", () => {
    // Стейблы: база 0 знаков, но при дробном шаге подписи слиплись бы
    const axis = { min: 0, max: 5, ticks: [0, 2.5, 5] };
    expect(tickDecimals(axis, 0)).toBe(1);
  });

  it("держится в разумных пределах на очень мелком шаге", () => {
    const axis = { min: 0, max: 1e-9, ticks: [0, 5e-10, 1e-9] };
    expect(tickDecimals(axis, 4)).toBe(8);
  });
});
