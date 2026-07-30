import { describe, expect, it } from "vitest";
import { computeOverview } from "./overview";

/**
 * Связка пяти чисел (Фаза 4, S4.2). Ключевое свойство — честная
 * null-пропагация: «данных о долге нет» никогда не выдается за «долга нет».
 */

describe("computeOverview", () => {
  it("формулы методики: Чистая = Активы − Долг; Прибыль = Чистая − Внесено", () => {
    const o = computeOverview({
      assetsUsd: 150_000,
      hasWallets: true,
      healthRows: [{ totalDebtUsd: 30_000 }, { totalDebtUsd: 10_000 }],
      depositedUsd: 80_000,
    });
    expect(o).toEqual({
      assetsUsd: 150_000,
      debtUsd: 40_000,
      netUsd: 110_000,
      depositedUsd: 80_000,
      profitUsd: 30_000,
    });
  });

  it("долг ни разу не прочитан (кошельки есть) -> debt/net/profit null, не ноль", () => {
    const o = computeOverview({
      assetsUsd: 100_000,
      hasWallets: true,
      healthRows: [],
      depositedUsd: 50_000,
    });
    expect(o.debtUsd).toBeNull();
    expect(o.netUsd).toBeNull();
    expect(o.profitUsd).toBeNull();
    // «Внесено» при этом известно всегда — журнал локальный
    expect(o.depositedUsd).toBe(50_000);
  });

  it("нулевой долг ≠ отсутствию данных: net и profit считаются", () => {
    const o = computeOverview({
      assetsUsd: 100_000,
      hasWallets: true,
      healthRows: [{ totalDebtUsd: 0 }],
      depositedUsd: 60_000,
    });
    expect(o.debtUsd).toBe(0);
    expect(o.netUsd).toBe(100_000);
    expect(o.profitUsd).toBe(40_000);
  });

  it("без кошельков on-chain долга быть не может: debtUsd = 0", () => {
    const o = computeOverview({
      assetsUsd: 20_000,
      hasWallets: false,
      healthRows: [],
      depositedUsd: 5_000,
    });
    expect(o.debtUsd).toBe(0);
    expect(o.netUsd).toBe(20_000);
    expect(o.profitUsd).toBe(15_000);
  });

  it("неизвестный долг одной сети делает суммарный долг неизвестным целиком", () => {
    // Частичная сумма выглядела бы как маленький долг — это ложь
    const o = computeOverview({
      assetsUsd: 100_000,
      hasWallets: true,
      healthRows: [{ totalDebtUsd: 10_000 }, { totalDebtUsd: null }],
      depositedUsd: 0,
    });
    expect(o.debtUsd).toBeNull();
    expect(o.netUsd).toBeNull();
    expect(o.profitUsd).toBeNull();
  });

  it("вывод собственных средств уменьшает «Внесено»: прибыль растет", () => {
    // Внесли 100k, вывели 30k -> Внесено 70k
    const o = computeOverview({
      assetsUsd: 90_000,
      hasWallets: true,
      healthRows: [{ totalDebtUsd: 0 }],
      depositedUsd: 70_000,
    });
    expect(o.profitUsd).toBe(20_000);
  });
});
