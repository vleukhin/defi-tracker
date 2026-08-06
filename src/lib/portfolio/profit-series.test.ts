import { describe, expect, it } from "vitest";
import type { SnapshotDto } from "@/lib/api/types";
import { computeOverview } from "./overview";
import {
  type DepositEntry,
  depositedAsOf,
  profitChange,
  profitSeries,
} from "./profit-series";

/**
 * Прибыль по истории. Главное, что проверяется, — что серия отказывается
 * считать точку, в которой хоть одно слагаемое неизвестно, и что она
 * не расходится с числом в шапке Портфеля.
 */

interface Point {
  totalUsd?: number;
  positionsUsd?: number | null;
  freeBorrowedUsd?: number | null;
  debtUsd?: number | null;
  isPartial?: boolean;
}

function snapshot(takenOn: string, point: Point = {}): SnapshotDto {
  return {
    id: takenOn,
    takenOn,
    takenAt: `${takenOn}T03:00:00.000Z`,
    totalUsd: point.totalUsd ?? 100_000,
    debtUsd: point.debtUsd === undefined ? 40_000 : point.debtUsd,
    // Прибыль от залога и HF не зависит — на серию эти поля не влияют
    collateralUsd: null,
    healthFactor: null,
    positionsUsd: point.positionsUsd === undefined ? 30_000 : point.positionsUsd,
    freeBorrowedUsd:
      point.freeBorrowedUsd === undefined ? 0 : point.freeBorrowedUsd,
    freeUsd: 0,
    isPartial: point.isPartial ?? false,
    items: [],
  };
}

function deposit(happenedOn: string, amount: number): DepositEntry {
  return { happenedOn, amount: String(amount) };
}

describe("depositedAsOf", () => {
  const journal = [
    deposit("2026-07-01", 50_000),
    deposit("2026-07-15", 10_000),
    deposit("2026-07-20", -4_000),
  ];

  it("считает по указанный день ВКЛЮЧИТЕЛЬНО", () => {
    // Граница включительная, чтобы последняя точка графика совпадала
    // с «Внесено» в шапке Портфеля, которое суммирует весь журнал
    expect(depositedAsOf(journal, "2026-07-15")).toBe(60_000);
  });

  it("записи после даты в сумму не попадают", () => {
    expect(depositedAsOf(journal, "2026-07-14")).toBe(50_000);
    expect(depositedAsOf(journal, "2026-06-30")).toBe(0);
  });

  it("вывод собственных средств уменьшает Внесено", () => {
    expect(depositedAsOf(journal, "2026-07-20")).toBe(56_000);
  });
});

describe("profitSeries", () => {
  it("Прибыль = (портфель + позиции + заемные свободные − долг) − Внесено", () => {
    const points = profitSeries(
      [snapshot("2026-08-01"), snapshot("2026-08-02")],
      [deposit("2026-07-01", 50_000)],
    );

    expect(points).toHaveLength(2);
    expect(points[0].assetsUsd).toBe(130_000);
    expect(points[0].netUsd).toBe(90_000);
    expect(points[0].depositedUsd).toBe(50_000);
    expect(points[0].profitUsd).toBe(40_000);
  });

  it("совпадает с computeOverview на тех же числах", () => {
    // Анти-дрейф: график и число в шапке считаются одним кодом. Разойдясь,
    // они противоречили бы друг другу, и понять, кто врет, было бы нечем
    const overview = computeOverview({
      portfolioUsd: 100_000,
      positionsUsd: 30_000,
      freeBorrowedUsd: 20_000,
      hasWallets: true,
      healthRows: [{ totalDebtUsd: 40_000 }],
      depositedUsd: 50_000,
    });
    const [point] = profitSeries(
      [snapshot("2026-08-01", { freeBorrowedUsd: 20_000 })],
      [deposit("2026-07-01", 50_000)],
    );

    expect(point.assetsUsd).toBe(overview.assetsUsd);
    expect(point.netUsd).toBe(overview.netUsd);
    expect(point.profitUsd).toBe(overview.profitUsd);
  });

  it("вывод собственных средств поднимает Прибыль на ту же дату", () => {
    const points = profitSeries(
      [snapshot("2026-08-01"), snapshot("2026-08-02")],
      [deposit("2026-07-01", 50_000), deposit("2026-08-02", -10_000)],
    );

    expect(points[0].profitUsd).toBe(40_000);
    expect(points[1].profitUsd).toBe(50_000);
  });

  it("пополнение в день снепшота дает провал на один день", () => {
    // ИЗВЕСТНЫЙ АРТЕФАКТ, а не баг: журнал дневной, снепшот снимается
    // в 03:00 UTC, поэтому взнос попадает во «Внесено» раньше, чем деньги
    // видны в балансах. Исключительная граница дала бы такой же скачок
    // при «Снепшот сейчас» и разошлась бы с числом в шапке — чинить нечего
    const points = profitSeries(
      [snapshot("2026-08-01"), snapshot("2026-08-02"), snapshot("2026-08-03")],
      [deposit("2026-08-02", 10_000)],
    );

    expect(points.map((p) => p.profitUsd)).toEqual([90_000, 80_000, 80_000]);
  });

  it("долг не читался — точки нет, а не ноль", () => {
    const points = profitSeries(
      [snapshot("2026-08-01", { debtUsd: null }), snapshot("2026-08-02")],
      [],
    );

    expect(points.map((p) => p.takenOn)).toEqual(["2026-08-02"]);
  });

  it("стоимость позиций неизвестна — точки в серии нет", () => {
    const points = profitSeries(
      [snapshot("2026-08-01", { positionsUsd: null })],
      [],
    );

    expect(points).toEqual([]);
  });

  it("точка до колонки free_borrowed_usd выпадает из серии, а не считается нулем", () => {
    // Ноль занизил бы Активы ровно на занятую сумму — Долг-то вычитается
    // целиком, и на графике был бы провал в день займа
    const points = profitSeries(
      [snapshot("2026-08-01", { freeBorrowedUsd: null }), snapshot("2026-08-02")],
      [],
    );

    expect(points.map((p) => p.takenOn)).toEqual(["2026-08-02"]);
  });

  it("пустой журнал: Прибыль равна Чистой", () => {
    const [point] = profitSeries([snapshot("2026-08-01")], []);
    expect(point.profitUsd).toBe(point.netUsd);
  });

  it("журнал приходит новыми вперед — порядок не влияет на результат", () => {
    // GET /api/deposits отдает happened_on desc, реплей идет по возрастанию
    const desc = [deposit("2026-07-15", 10_000), deposit("2026-07-01", 50_000)];
    const [point] = profitSeries([snapshot("2026-08-01")], desc);
    expect(point.depositedUsd).toBe(60_000);
  });

  it("пропущенные дни не достраиваются: в серии только посчитанные точки", () => {
    const points = profitSeries(
      [snapshot("2026-08-01"), snapshot("2026-08-05")],
      [],
    );
    expect(points.map((p) => p.takenOn)).toEqual(["2026-08-01", "2026-08-05"]);
  });

  it("частичность точки переносится в серию", () => {
    const [point] = profitSeries(
      [snapshot("2026-08-01", { isPartial: true })],
      [],
    );
    expect(point.isPartial).toBe(true);
  });
});

describe("profitChange", () => {
  it("считает изменение по первой и последней ПОСЧИТАННОЙ точке", () => {
    const points = profitSeries(
      [
        snapshot("2026-08-01", { totalUsd: 100_000 }),
        snapshot("2026-08-02", { debtUsd: null }),
        snapshot("2026-08-03", { totalUsd: 115_000 }),
      ],
      [],
    );

    expect(profitChange(points)).toEqual({
      from: 90_000,
      to: 105_000,
      abs: 15_000,
    });
  });

  it("одна точка — изменения нет", () => {
    expect(profitChange(profitSeries([snapshot("2026-08-01")], []))).toBeNull();
  });
});
