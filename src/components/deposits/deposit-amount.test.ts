import { describe, expect, it } from "vitest";
import { signedDepositAmount } from "./deposit-amount";

describe("signedDepositAmount", () => {
  it("пополнение — положительная строка как есть", () => {
    expect(signedDepositAmount("in", "5000")).toBe("5000");
    expect(signedDepositAmount("in", "0.5")).toBe("0.5");
  });

  it("вывод — знак ставится за пользователя", () => {
    expect(signedDepositAmount("out", "1200")).toBe("-1200");
    expect(signedDepositAmount("out", "1200.50")).toBe("-1200.50");
  });

  it("запятая толерантна", () => {
    expect(signedDepositAmount("in", "1200,5")).toBe("1200.5");
    expect(signedDepositAmount("out", " 300,25 ")).toBe("-300.25");
  });

  it("ноль невалиден — запись без смысла", () => {
    expect(signedDepositAmount("in", "0")).toBeNull();
    expect(signedDepositAmount("out", "0,00")).toBeNull();
  });

  it("мусор и собственноручный минус невалидны", () => {
    expect(signedDepositAmount("in", "")).toBeNull();
    expect(signedDepositAmount("in", "abc")).toBeNull();
    // Минус вводится не руками, а переключателем «Вывод»
    expect(signedDepositAmount("in", "-100")).toBeNull();
    expect(signedDepositAmount("out", "-100")).toBeNull();
  });
});
