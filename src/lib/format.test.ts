import { describe, expect, it } from "vitest";
import {
  MINUS,
  NBSP,
  chainLabel,
  formatQuantity,
  formatQuantityFull,
  formatRelativeTime,
  tableNumber,
  tablePct,
  tablePctSigned,
  tableDate,
  tableQuantity,
  tableSigned,
  tableUsd,
  tableUsdSigned,
  truncateAddress,
  usdDecimals,
} from "./format";

describe("formatQuantity (десятичные строки, без float)", () => {
  it("целая часть ненулевая — 4 знака дроби, усечение без округления", () => {
    expect(formatQuantity("1234.567891")).toBe(`1${NBSP}234.5678`);
  });

  it("число < 1 — ведущие нули + 4 значащие цифры", () => {
    expect(formatQuantity("0.000123456")).toBe("0.0001234");
  });

  it("убирает хвостовые нули", () => {
    expect(formatQuantity("2.5000")).toBe("2.5");
    expect(formatQuantity("2.0000")).toBe("2");
  });

  it("целое без дроби", () => {
    expect(formatQuantity("42")).toBe("42");
    expect(formatQuantity("42.0")).toBe("42");
  });

  it("очень длинная дробь (18 decimals) не теряет порядок", () => {
    expect(formatQuantity("0.000000000000000001")).toBe("0.000000000000000001");
  });

  it("большое количество группируется", () => {
    expect(formatQuantity("1000000.123456")).toBe(`1${NBSP}000${NBSP}000.1234`);
  });

  it("нормализует ведущие нули целой части", () => {
    expect(formatQuantity("0042.1")).toBe("42.1");
  });
});

describe("formatQuantityFull", () => {
  it("полная дробь + группировка целой части", () => {
    expect(formatQuantityFull("1234.567891234")).toBe(`1${NBSP}234.567891234`);
  });

  it("без дроби", () => {
    expect(formatQuantityFull("1000000")).toBe(`1${NBSP}000${NBSP}000`);
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-07-30T12:00:00Z");

  it("null и мусор -> null", () => {
    expect(formatRelativeTime(null, now)).toBeNull();
    expect(formatRelativeTime("not-a-date", now)).toBeNull();
  });

  it("< 60 c — «только что»", () => {
    expect(formatRelativeTime("2026-07-30T11:59:30Z", now)).toBe("только что");
  });

  it("минуты", () => {
    expect(formatRelativeTime("2026-07-30T11:55:00Z", now)).toBe(
      `5${NBSP}мин назад`,
    );
  });

  it("часы", () => {
    expect(formatRelativeTime("2026-07-30T09:00:00Z", now)).toBe(
      `3${NBSP}ч назад`,
    );
  });

  it("дни", () => {
    expect(formatRelativeTime("2026-07-28T11:00:00Z", now)).toBe(
      `2${NBSP}дн назад`,
    );
  });

  it("время в будущем (рассинхрон часов) — «только что», не отрицательное", () => {
    expect(formatRelativeTime("2026-07-30T12:05:00Z", now)).toBe("только что");
  });
});

describe("truncateAddress", () => {
  it("0x1234…abcd", () => {
    expect(
      truncateAddress("0x1234567890AbcdEF1234567890aBcdef1234abcd"),
    ).toBe("0x1234…abcd");
  });

  it("короткие строки не трогает", () => {
    expect(truncateAddress("0x1234")).toBe("0x1234");
  });
});

describe("chainLabel", () => {
  it("известные сети — с заглавной", () => {
    expect(chainLabel("ethereum")).toBe("Ethereum");
    expect(chainLabel("arbitrum")).toBe("Arbitrum");
  });

  it("неизвестная сеть — как есть", () => {
    expect(chainLabel("zksync")).toBe("zksync");
  });
});

/**
 * Табличный формат: воспроизводит вид рабочей таблицы пользователя —
 * десятичная запятая, сохранение нулей, «$» без отбивки.
 */
describe("табличный формат", () => {
  it("количество: запятая, группировка тысяч, нули сохраняются", () => {
    expect(tableNumber(1.2611, 4)).toBe("1,2611");
    expect(tableNumber(16.9188, 4)).toBe("16,9188");
    // Нули не срезаются — колонки выравниваются как в таблице
    expect(tableNumber(1.2, 4)).toBe("1,2000");
    expect(tableNumber(39548, 0)).toBe(`39${NBSP}548`);
    expect(tableNumber(5350.2713, 4)).toBe(`5${NBSP}350,2713`);
  });

  it("количество: типографский минус", () => {
    expect(tableNumber(-0.071486, 6)).toBe(`${MINUS}0,071486`);
  });

  it("к ребалансировке: плюс показывается явно (знак не только цветом)", () => {
    expect(tableSigned(6352, 0)).toBe(`+6${NBSP}352`);
    expect(tableSigned(-0.917713, 6)).toBe(`${MINUS}0,917713`);
    expect(tableSigned(0, 2)).toBe("0,00");
  });

  it("доллары: без пробела после знака валюты, без копеек", () => {
    expect(tableUsd(81098)).toBe(`$81${NBSP}098`);
    expect(tableUsd(1)).toBe("$1");
    expect(tableUsd(153001)).toBe(`$153${NBSP}001`);
    expect(tableUsd(-1234)).toBe(`${MINUS}$1${NBSP}234`);
  });

  it("проценты: две цифры с сохранением нулей", () => {
    expect(tablePct(53)).toBe("53,00%");
    expect(tablePct(21.147)).toBe("21,15%");
    expect(tablePctSigned(3)).toBe("+3,00%");
    expect(tablePctSigned(-4.15)).toBe(`${MINUS}4,15%`);
  });

  it("количество из строки: запятая, точность не теряется", () => {
    expect(tableQuantity("1.26100000")).toBe("1,261");
    expect(tableQuantity("0.000000012345678", true)).toBe("0,000000012345678");
  });

  it("нечисловое значение не превращается в NaN на экране", () => {
    expect(tableNumber(Number.NaN, 2)).toBe("—");
    expect(tableUsd(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

/** Фаза 2: P/L, цены сделок и даты журнала. */
describe("формат леджера", () => {
  it("P/L в долларах: плюс показывается явно (знак не только цветом)", () => {
    expect(tableUsdSigned(1234)).toBe(`+$1${NBSP}234`);
    expect(tableUsdSigned(-1234)).toBe(`${MINUS}$1${NBSP}234`);
    expect(tableUsdSigned(0)).toBe("$0");
    expect(tableUsdSigned(3.5, 2)).toBe("+$3,50");
  });

  it("точность цен адаптивная: крупные — целые, мелкие — с копейками", () => {
    expect(usdDecimals(60000)).toBe(0);
    expect(usdDecimals(999.5)).toBe(2);
    expect(usdDecimals(-1200)).toBe(0);
    expect(tableUsd(1.0005, usdDecimals(1.0005))).toBe("$1,00");
  });

  it("дата сделки: дд.мм.гггг по UTC, без сдвига поясом", () => {
    expect(tableDate("2026-07-29T00:00:00.000Z")).toBe("29.07.2026");
    expect(tableDate("2026-01-05T23:59:59.000Z")).toBe("05.01.2026");
    expect(tableDate("мусор")).toBe("—");
  });
});
