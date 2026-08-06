import { describe, expect, it } from "vitest";
import { type DebtHealthRow, summarizeDebtHealth } from "./debt-health";

const row = (
  collateral: number | null,
  debt: number | null,
  hf: number | null,
): DebtHealthRow => ({
  totalCollateralUsd: collateral,
  totalDebtUsd: debt,
  healthFactor: hf,
});

describe("summarizeDebtHealth", () => {
  it("HF — минимум по (кошелек, сеть), а не среднее", () => {
    // Ликвидация приходит к худшей позиции: среднее 1,9 скрыло бы 1,25
    const s = summarizeDebtHealth(
      [row(100_000, 40_000, 2.55), row(50_000, 30_000, 1.25)],
      true,
    );
    expect(s.minHealthFactor).toBe(1.25);
    expect(s.collateralUsd).toBe(150_000);
  });

  it("неизвестный залог одной строки делает неизвестной всю сумму", () => {
    // Частичная сумма — это заниженный залог, то есть завышенный LTV
    const s = summarizeDebtHealth(
      [row(100_000, 40_000, 2.55), row(null, 30_000, 1.25)],
      true,
    );
    expect(s.collateralUsd).toBeNull();
    // HF при этом известен: он не выводится из сумм
    expect(s.minHealthFactor).toBe(1.25);
  });

  it("кошельки есть, здоровье не читалось — залог null, а не ноль", () => {
    const s = summarizeDebtHealth([], true);
    expect(s.collateralUsd).toBeNull();
    expect(s.minHealthFactor).toBeNull();
  });

  it("кошельков нет — залога честный ноль", () => {
    const s = summarizeDebtHealth([], false);
    expect(s.collateralUsd).toBe(0);
    expect(s.minHealthFactor).toBeNull();
  });

  it("строки без долга в минимум не попадают: «∞» не ноль", () => {
    // HF null у Aave = долга нет; засчитав его как 0, получили бы
    // «ликвидация уже произошла» на кошельке без единого займа
    const s = summarizeDebtHealth(
      [row(100_000, 0, null), row(50_000, 30_000, 1.8)],
      true,
    );
    expect(s.minHealthFactor).toBe(1.8);
  });

  it("долга нет нигде — HF null («∞»), залог при этом известен", () => {
    const s = summarizeDebtHealth([row(100_000, 0, null)], true);
    expect(s.minHealthFactor).toBeNull();
    expect(s.collateralUsd).toBe(100_000);
  });
});
