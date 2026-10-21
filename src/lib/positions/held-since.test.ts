import { describe, expect, it } from "vitest";
import { holdingStart, type TokenTransfer } from "./held-since";

/**
 * Начало удержания — по истории переводов. Шкала до погашения начинается
 * отсюда, поэтому главное правило: докупки начало не сдвигают, а полный
 * выход и повторный вход — начинают отсчёт заново.
 */

const t = (
  block: number,
  direction: TokenTransfer["direction"],
  amount: number,
  logIndex = 0,
): TokenTransfer => ({
  block: BigInt(block),
  logIndex,
  direction,
  amount: BigInt(amount),
  timestampSec: BigInt(block * 10),
});

describe("начало удержания", () => {
  it("одна покупка — её и дата", () => {
    expect(holdingStart([t(100, "in", 50)])?.block).toBe(100n);
  });

  it("докупки начало не сдвигают", () => {
    expect(holdingStart([t(100, "in", 50), t(200, "in", 30)])?.block).toBe(100n);
  });

  it("частичная продажа начало не сдвигает", () => {
    expect(holdingStart([t(100, "in", 50), t(150, "out", 20)])?.block).toBe(100n);
  });

  it("полный выход и повторный вход — новое удержание", () => {
    expect(
      holdingStart([t(100, "in", 50), t(150, "out", 50), t(300, "in", 10)])?.block,
    ).toBe(300n);
  });

  it("порядок в ответе не важен — сортируется по блоку и событию", () => {
    expect(
      holdingStart([t(300, "in", 10), t(150, "out", 50), t(100, "in", 50)])?.block,
    ).toBe(300n);
  });

  it("перевод самому себе не обнуляет баланс внутри события", () => {
    expect(
      holdingStart([t(100, "in", 50), t(200, "out", 50, 3), t(200, "in", 50, 3)])
        ?.block,
    ).toBe(100n);
  });

  it("баланс по истории нулевой — ответа нет", () => {
    expect(holdingStart([t(100, "in", 50), t(150, "out", 50)])).toBeNull();
    expect(holdingStart([])).toBeNull();
  });

  it("неполная история (ушло больше, чем пришло) — следующее поступление начинает заново", () => {
    expect(holdingStart([t(150, "out", 80), t(300, "in", 10)])?.block).toBe(300n);
  });
});
