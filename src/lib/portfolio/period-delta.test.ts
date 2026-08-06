import { describe, expect, it } from "vitest";
import type { SnapshotDto } from "@/lib/api/types";
import { periodDelta } from "./period-delta";

function snap(
  takenOn: string,
  totalUsd: number,
  positionsUsd: number | null = null,
): SnapshotDto {
  return {
    id: takenOn,
    takenOn,
    takenAt: `${takenOn}T00:00:00.000Z`,
    totalUsd,
    debtUsd: null,
    positionsUsd,
    isPartial: false,
  } as SnapshotDto;
}

describe("periodDelta", () => {
  it("одной точки для дельты не хватает", () => {
    expect(periodDelta([], "portfolio")).toBeNull();
    expect(periodDelta([snap("2026-07-01", 100)], "assets")).toBeNull();
  });

  it("портфель считается только по totalUsd", () => {
    const rows = [snap("2026-07-01", 100, 50), snap("2026-07-30", 120, 90)];
    expect(periodDelta(rows, "portfolio")).toEqual({
      absolute: 20,
      percent: 20,
    });
  });

  it("активы включают размещённые позиции", () => {
    const rows = [snap("2026-07-01", 100, 50), snap("2026-07-30", 120, 90)];
    // 150 → 210
    expect(periodDelta(rows, "assets")).toEqual({ absolute: 60, percent: 40 });
  });

  it("позиции неизвестны на одном конце — сравнение падает на портфель", () => {
    // Иначе переезд капитала в позицию выглядел бы доходом
    const rows = [snap("2026-07-01", 100, null), snap("2026-07-30", 120, 90)];
    expect(periodDelta(rows, "assets")).toEqual({ absolute: 20, percent: 20 });
  });

  it("нулевой старт не даёт Infinity в процентах", () => {
    const rows = [snap("2026-07-01", 0), snap("2026-07-30", 120)];
    expect(periodDelta(rows, "portfolio")).toEqual({
      absolute: 120,
      percent: null,
    });
  });

  it("сравниваются концы окна, а не соседние точки", () => {
    const rows = [
      snap("2026-07-01", 100),
      snap("2026-07-15", 500),
      snap("2026-07-30", 130),
    ];
    expect(periodDelta(rows, "portfolio")?.absolute).toBe(30);
  });

  it("два экрана «Портфеля» больше не расходятся молча", () => {
    // Регрессия: hero считал по «активам», карточка «Динамика стоимости» —
    // по портфелю, и оба подписывали результат «за 30 дней». Числа обязаны
    // различаться (это разные величины), но подписи их теперь разводят.
    const rows = [snap("2026-07-01", 100, 50), snap("2026-07-30", 120, 90)];
    const portfolio = periodDelta(rows, "portfolio");
    const assets = periodDelta(rows, "assets");
    expect(portfolio).not.toEqual(assets);
  });
});
