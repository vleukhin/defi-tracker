import { describe, expect, it } from "vitest";
import { depositSchema, sumDeposits, toDepositColumns } from "./deposits";

/**
 * Журнал «Внесено» (S4.0): подписанные суммы. Ключевые свойства —
 * знак сохраняется (вывод уменьшает итог), ноль запрещен, будущее запрещено.
 */

describe("depositSchema", () => {
  it("принимает пополнение и вывод (подписанные суммы), число и строку", () => {
    const plus = depositSchema.parse({
      amount: 50_000,
      happenedOn: "2026-01-15",
    });
    expect(plus.amount).toBe("50000");
    expect(plus.note).toBeNull();

    const minus = depositSchema.parse({
      amount: "-12000.50",
      happenedOn: "2026-02-01",
      note: "вывод на карту",
    });
    expect(minus.amount).toBe("-12000.50");
    expect(minus.note).toBe("вывод на карту");
  });

  it("толерантен к запятой: «-1 234,5» не проходит, «-1234,5» — да", () => {
    expect(
      depositSchema.parse({ amount: "-1234,5", happenedOn: "2026-01-01" })
        .amount,
    ).toBe("-1234.5");
    expect(
      depositSchema.safeParse({ amount: "-1 234,5", happenedOn: "2026-01-01" })
        .success,
    ).toBe(false);
  });

  it("ноль запрещен — такая запись ничего не значит", () => {
    for (const amount of [0, "0", "0.00", "-0"]) {
      expect(
        depositSchema.safeParse({ amount, happenedOn: "2026-01-01" }).success,
        `amount = ${JSON.stringify(amount)}`,
      ).toBe(false);
    }
  });

  it("дата в будущем запрещена, сегодня — валидна", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(
      depositSchema.safeParse({ amount: 1, happenedOn: today }).success,
    ).toBe(true);
    const future = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(
      depositSchema.safeParse({ amount: 1, happenedOn: future }).success,
    ).toBe(false);
  });

  it("отклоняет мусорные даты и длинные заметки", () => {
    expect(
      depositSchema.safeParse({ amount: 1, happenedOn: "15.01.2026" }).success,
    ).toBe(false);
    expect(
      depositSchema.safeParse({
        amount: 1,
        happenedOn: "2026-01-15",
        note: "x".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("toDepositColumns переносит happened_on как есть (date, не timestamp)", () => {
    const cols = toDepositColumns(
      depositSchema.parse({ amount: "10", happenedOn: "2026-01-15" }),
    );
    expect(cols).toEqual({ amount: "10", happened_on: "2026-01-15", note: null });
  });
});

describe("sumDeposits", () => {
  it("подписанная математика: выводы уменьшают «Внесено»", () => {
    expect(
      sumDeposits([
        { amount: "100000" },
        { amount: "-30000" },
        { amount: 12_500.5 },
      ]),
    ).toBeCloseTo(82_500.5, 6);
  });

  it("пустой журнал — честный ноль", () => {
    expect(sumDeposits([])).toBe(0);
  });
});
