import { describe, expect, it } from "vitest";
import { buildLeverage, type BorrowInput } from "./leverage";
import type { PositionDto } from "@/lib/api/types";

/**
 * Экран «Левередж» (S5.3): оправдывает ли себя связка «занял и разместил».
 *
 * Отдельно проверяется итог при связи многие-ко-многим: складывать строки
 * нельзя — одна позиция, привязанная к двум займам, посчиталась бы дважды.
 */

function position(id: string, valueUsd: number | null): PositionDto {
  return {
    id,
    protocol: "gmx_v2",
    protocolLabel: "GMX v2",
    chain: "arbitrum",
    zone: "yield",
    zoneKey: `gmx_v2:arbitrum:${id}`,
    ownPrincipalUsd: null,
    borrowedPrincipalUsd: null,
    ownCurrentUsd: 0,
    profitUsd: null,
    profitPct: null,
    title: `GM ${id}`,
    subtitle: null,
    quantity: "1",
    valueUsd,
    components: [],
    feesUsd: null,
    inRange: null,
    walletId: "w1",
    walletLabel: null,
    updatedAt: "2026-07-31T03:00:00.000Z",
  };
}

const borrow = (
  id: string,
  quantity: string,
  coingeckoId: string | null = "usd-coin",
): BorrowInput => ({
  id,
  chain: "arbitrum",
  symbol: "USDC",
  quantity,
  coingeckoId,
});

const PRICES = new Map([["usd-coin", 1]]);

describe("buildLeverage", () => {
  it("считает дельту займа против привязанных позиций", () => {
    const r = buildLeverage({
      positions: [position("p1", 11_000)],
      borrows: [borrow("b1", "10000")],
      links: [{ borrowId: "b1", positionId: "p1" }],
      pricesUsd: PRICES,
    });
    expect(r.borrows[0].debtUsd).toBe(10_000);
    expect(r.borrows[0].linkedUsd).toBe(11_000);
    expect(r.borrows[0].deltaUsd).toBe(1_000);
    expect(r.borrows[0].deltaPct).toBeCloseTo(10, 9);
  });

  it("отрицательная дельта — связка не окупается", () => {
    const r = buildLeverage({
      positions: [position("p1", 9_000)],
      borrows: [borrow("b1", "10000")],
      links: [{ borrowId: "b1", positionId: "p1" }],
      pricesUsd: PRICES,
    });
    expect(r.borrows[0].deltaUsd).toBe(-1_000);
    expect(r.borrows[0].deltaPct).toBeCloseTo(-10, 9);
  });

  it("один займ финансирует несколько позиций", () => {
    const r = buildLeverage({
      positions: [position("p1", 6_000), position("p2", 5_000)],
      borrows: [borrow("b1", "10000")],
      links: [
        { borrowId: "b1", positionId: "p1" },
        { borrowId: "b1", positionId: "p2" },
      ],
      pricesUsd: PRICES,
    });
    expect(r.borrows[0].linkedUsd).toBe(11_000);
    expect(r.borrows[0].linkedPositionIds).toHaveLength(2);
  });

  it("итог по уникальным позициям: общая позиция не считается дважды", () => {
    // p1 привязана к обоим займам — в сумме она должна быть одна
    const r = buildLeverage({
      positions: [position("p1", 20_000)],
      borrows: [borrow("b1", "10000"), borrow("b2", "5000")],
      links: [
        { borrowId: "b1", positionId: "p1" },
        { borrowId: "b2", positionId: "p1" },
      ],
      pricesUsd: PRICES,
    });
    expect(r.linkedDebtUsd).toBe(15_000);
    expect(r.linkedPositionsUsd).toBe(20_000);
    expect(r.linkedDeltaUsd).toBe(5_000);
  });

  it("займ без привязок: дельта неизвестна, но сам займ виден", () => {
    const r = buildLeverage({
      positions: [position("p1", 5_000)],
      borrows: [borrow("b1", "10000")],
      links: [],
      pricesUsd: PRICES,
    });
    expect(r.borrows[0].debtUsd).toBe(10_000);
    expect(r.borrows[0].linkedUsd).toBeNull();
    expect(r.borrows[0].deltaUsd).toBeNull();
    // В итог непривязанные займы не входят
    expect(r.linkedDebtUsd).toBe(0);
  });

  it("связка на исчезнувшую позицию игнорируется", () => {
    // Средства вывели, строка protocol_positions удалена
    const r = buildLeverage({
      positions: [],
      borrows: [borrow("b1", "10000")],
      links: [{ borrowId: "b1", positionId: "уже-нет" }],
      pricesUsd: PRICES,
    });
    expect(r.borrows[0].linkedPositionIds).toHaveLength(0);
    expect(r.borrows[0].linkedUsd).toBeNull();
  });

  it("нет цены занятого токена — долг неизвестен, а не ноль", () => {
    const r = buildLeverage({
      positions: [position("p1", 11_000)],
      borrows: [borrow("b1", "10000", null)],
      links: [{ borrowId: "b1", positionId: "p1" }],
      pricesUsd: PRICES,
    });
    expect(r.borrows[0].debtUsd).toBeNull();
    expect(r.borrows[0].deltaUsd).toBeNull();
    expect(r.borrows[0].deltaPct).toBeNull();
  });

  it("неоцененная позиция делает неизвестной всю привязанную сумму", () => {
    const r = buildLeverage({
      positions: [position("p1", 5_000), position("p2", null)],
      borrows: [borrow("b1", "10000")],
      links: [
        { borrowId: "b1", positionId: "p1" },
        { borrowId: "b1", positionId: "p2" },
      ],
      pricesUsd: PRICES,
    });
    expect(r.borrows[0].linkedUsd).toBeNull();
    expect(r.borrows[0].deltaUsd).toBeNull();
  });

  it("нулевой долг не дает деления на ноль в проценте", () => {
    const r = buildLeverage({
      positions: [position("p1", 100)],
      borrows: [borrow("b1", "0")],
      links: [{ borrowId: "b1", positionId: "p1" }],
      pricesUsd: PRICES,
    });
    expect(r.borrows[0].deltaUsd).toBe(100);
    expect(r.borrows[0].deltaPct).toBeNull();
  });

  it("займы сортируются по величине долга", () => {
    const r = buildLeverage({
      positions: [],
      borrows: [borrow("b1", "1000"), borrow("b2", "9000"), borrow("b3", "5000")],
      links: [],
      pricesUsd: PRICES,
    });
    expect(r.borrows.map((b) => b.debtUsd)).toEqual([9000, 5000, 1000]);
  });
});
