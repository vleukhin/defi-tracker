import { describe, expect, it } from "vitest";
import { computeOverview } from "./overview";

/**
 * Связка пяти чисел (Фаза 4, S4.2 + Фаза 5).
 *
 * Два ключевых свойства:
 *  * честная null-пропагация — «данных нет» никогда не выдается за «ноль»;
 *  * Активы = портфель + размещенные позиции. Без второго слагаемого Чистая
 *    занижена ровно на заемные деньги, ушедшие в пулы: актив из Активов
 *    выпал, а долг из формулы — нет.
 */

describe("computeOverview", () => {
  it("формулы методики: Чистая = Активы − Долг; Прибыль = Чистая − Внесено", () => {
    const o = computeOverview({
      portfolioUsd: 150_000,
      positionsUsd: 0,
      hasWallets: true,
      healthRows: [{ totalDebtUsd: 30_000 }, { totalDebtUsd: 10_000 }],
      depositedUsd: 80_000,
    });
    expect(o).toEqual({
      assetsUsd: 150_000,
      portfolioUsd: 150_000,
      positionsUsd: 0,
      debtUsd: 40_000,
      netUsd: 110_000,
      depositedUsd: 80_000,
      profitUsd: 30_000,
    });
  });

  it("долг ни разу не прочитан (кошельки есть) -> debt/net/profit null, не ноль", () => {
    const o = computeOverview({
      portfolioUsd: 100_000,
      positionsUsd: 0,
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
      portfolioUsd: 100_000,
      positionsUsd: 0,
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
      portfolioUsd: 20_000,
      positionsUsd: 0,
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
      portfolioUsd: 100_000,
      positionsUsd: 0,
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
      portfolioUsd: 90_000,
      positionsUsd: 0,
      hasWallets: true,
      healthRows: [{ totalDebtUsd: 0 }],
      depositedUsd: 70_000,
    });
    expect(o.profitUsd).toBe(20_000);
  });

  // --- Фаза 5: размещенные позиции в Активах ---

  it("размещенные позиции входят в Активы", () => {
    const o = computeOverview({
      portfolioUsd: 150_000,
      positionsUsd: 40_000,
      hasWallets: true,
      healthRows: [{ totalDebtUsd: 40_000 }],
      depositedUsd: 150_000,
    });
    expect(o.assetsUsd).toBe(190_000);
    expect(o.netUsd).toBe(150_000);
    // Заняли 40k и разместили их: Чистая не изменилась, прибыль нулевая
    expect(o.profitUsd).toBe(0);
  });

  it("без учета позиций Чистая была бы занижена на размещенный заем", () => {
    const common = {
      portfolioUsd: 150_000,
      hasWallets: true,
      healthRows: [{ totalDebtUsd: 40_000 }],
      depositedUsd: 150_000,
    };
    const doFix = computeOverview({ ...common, positionsUsd: 0 });
    const posle = computeOverview({ ...common, positionsUsd: 40_000 });
    expect(posle.netUsd! - doFix.netUsd!).toBe(40_000);
    // Ровно та ошибка, которую закрывает Фаза 5
    expect(doFix.profitUsd).toBe(-40_000);
  });

  it("неизвестная стоимость позиций делает Активы, Чистую и Прибыль неизвестными", () => {
    const o = computeOverview({
      portfolioUsd: 150_000,
      positionsUsd: null,
      hasWallets: true,
      healthRows: [{ totalDebtUsd: 40_000 }],
      depositedUsd: 100_000,
    });
    expect(o.assetsUsd).toBeNull();
    expect(o.netUsd).toBeNull();
    expect(o.profitUsd).toBeNull();
    // Портфель при этом известен и показывается отдельно
    expect(o.portfolioUsd).toBe(150_000);
  });

  it("убыток пула виден: позиция стоит меньше профинансировавшего ее займа", () => {
    // Заняли 40k, положили в пул, пул подешевел до 35k
    const o = computeOverview({
      portfolioUsd: 150_000,
      positionsUsd: 35_000,
      hasWallets: true,
      healthRows: [{ totalDebtUsd: 40_000 }],
      depositedUsd: 150_000,
    });
    expect(o.profitUsd).toBe(-5_000);
  });
});
