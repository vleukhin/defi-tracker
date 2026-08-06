import { describe, expect, it } from "vitest";
import { buildDebtResponse, type BuildDebtInput } from "./debt";
import { settingsSchema } from "./settings";

/** Агрегация экрана «Долг» (S4.1/S4.3) и null-семантика итогов. */

function input(overrides: Partial<BuildDebtInput> = {}): BuildDebtInput {
  return {
    hasWallets: true,
    healthRows: [],
    positions: [],
    collateral: [],
    pricesUsd: new Map(),
    basePricesUsd: { btc: null, eth: null },
    hfWarningThreshold: 1.5,
    targetLtvPct: 50,
    ...overrides,
  };
}

describe("buildDebtResponse", () => {
  it("собирает сеть: totals, HF, utilization, оцененная разбивка", () => {
    const res = buildDebtResponse(
      input({
        healthRows: [
          {
            chain: "arbitrum",
            totalCollateralUsd: 50_000,
            totalDebtUsd: 20_000,
            healthFactor: 1.9,
            checkedAt: "2026-07-30T10:00:00Z",
          },
        ],
        positions: [
          { chain: "arbitrum", symbol: "USDC", coingeckoId: "usd-coin", quantity: "15000" },
          { chain: "arbitrum", symbol: "WETH", coingeckoId: "weth", quantity: "1.25" },
        ],
        pricesUsd: new Map([
          ["usd-coin", 1],
          ["weth", 4000],
        ]),
      }),
    );

    expect(res.chains).toHaveLength(1);
    const arb = res.chains[0];
    expect(arb.chain).toBe("arbitrum");
    expect(arb.totalDebtUsd).toBe(20_000);
    expect(arb.utilization).toBeCloseTo(0.4, 9);
    // Разбивка отсортирована по стоимости
    expect(arb.items.map((i) => i.symbol)).toEqual(["USDC", "WETH"]);
    expect(arb.items[1].valueUsd).toBeCloseTo(5_000, 6);

    expect(res.summary.totalDebtUsd).toBe(20_000);
    expect(res.summary.minHealthFactor).toBe(1.9);
    expect(res.summary.belowThreshold).toBe(false);
  });

  it("HF ниже порога -> belowThreshold; минимум берется по сетям с долгом", () => {
    const res = buildDebtResponse(
      input({
        healthRows: [
          { chain: "ethereum", totalCollateralUsd: 10_000, totalDebtUsd: 0, healthFactor: null, checkedAt: "t" },
          { chain: "arbitrum", totalCollateralUsd: 50_000, totalDebtUsd: 30_000, healthFactor: 1.31, checkedAt: "t" },
          { chain: "optimism", totalCollateralUsd: 20_000, totalDebtUsd: 5_000, healthFactor: 2.8, checkedAt: "t" },
        ],
      }),
    );
    // Связывающее ограничение — худшая сеть, а не средняя
    expect(res.summary.minHealthFactor).toBe(1.31);
    expect(res.summary.belowThreshold).toBe(true);
    // Сеть без долга: HF null («∞»), не гигантское число
    expect(res.chains.find((c) => c.chain === "ethereum")!.healthFactor).toBeNull();
  });

  it("токен без coingecko id или цены — количество без оценки, не ноль", () => {
    const res = buildDebtResponse(
      input({
        healthRows: [
          { chain: "base", totalCollateralUsd: 10_000, totalDebtUsd: 500, healthFactor: 5, checkedAt: "t" },
        ],
        positions: [
          { chain: "base", symbol: "EXOTIC", coingeckoId: null, quantity: "42.5" },
        ],
      }),
    );
    expect(res.chains[0].items[0]).toEqual({
      symbol: "EXOTIC",
      chain: "base",
      quantity: "42.5",
      valueUsd: null,
    });
  });

  it("пустое состояние: долга нет нигде — явный ответ, не ошибка", () => {
    const res = buildDebtResponse(
      input({
        healthRows: [
          { chain: "ethereum", totalCollateralUsd: 10_000, totalDebtUsd: 0, healthFactor: null, checkedAt: "t" },
        ],
      }),
    );
    expect(res.summary.totalDebtUsd).toBe(0);
    expect(res.summary.minHealthFactor).toBeNull();
    expect(res.summary.belowThreshold).toBe(false);
  });

  it("кошельки есть, здоровье не читалось ни разу -> totalDebtUsd null", () => {
    const res = buildDebtResponse(input());
    expect(res.chains).toEqual([]);
    expect(res.summary.totalDebtUsd).toBeNull();
  });

  it("без кошельков долг ноль, а не null", () => {
    const res = buildDebtResponse(input({ hasWallets: false }));
    expect(res.summary.totalDebtUsd).toBe(0);
  });

  it("состав залога сети — в фиксированном порядке, без дублей", () => {
    const res = buildDebtResponse(
      input({
        healthRows: [
          { chain: "arbitrum", totalCollateralUsd: 50_000, totalDebtUsd: 20_000, healthFactor: 1.9, checkedAt: "t" },
          { chain: "base", totalCollateralUsd: 10_000, totalDebtUsd: 2_000, healthFactor: 4, checkedAt: "t" },
        ],
        collateral: [
          // Порядок строк кэша обратный порядку колонок — и не должен на него влиять
          { chain: "arbitrum", category: "eth" },
          { chain: "arbitrum", category: "btc" },
          { chain: "arbitrum", category: "eth" },
          { chain: "base", category: "btc" },
        ],
        basePricesUsd: { btc: 95_000, eth: 3_200 },
      }),
    );
    const arb = res.chains.find((c) => c.chain === "arbitrum")!;
    expect(arb.collateralCategories).toEqual(["btc", "eth"]);
    // Сеть с одним базовым активом не получает чужую колонку
    expect(res.chains.find((c) => c.chain === "base")!.collateralCategories).toEqual(["btc"]);
    expect(res.basePricesUsd).toEqual({ btc: 95_000, eth: 3_200 });
  });

  it("залог не читался — пустой состав, а не выдуманные категории", () => {
    const res = buildDebtResponse(
      input({
        healthRows: [
          { chain: "arbitrum", totalCollateralUsd: 50_000, totalDebtUsd: 20_000, healthFactor: 1.9, checkedAt: "t" },
        ],
      }),
    );
    expect(res.chains[0].collateralCategories).toEqual([]);
    expect(res.basePricesUsd).toEqual({ btc: null, eth: null });
  });

  it("несколько кошельков на сеть: суммы складываются, HF — минимум", () => {
    const res = buildDebtResponse(
      input({
        healthRows: [
          { chain: "arbitrum", totalCollateralUsd: 30_000, totalDebtUsd: 10_000, healthFactor: 2.4, checkedAt: "2026-07-30T12:00:00Z" },
          { chain: "arbitrum", totalCollateralUsd: 20_000, totalDebtUsd: 8_000, healthFactor: 1.7, checkedAt: "2026-07-30T08:00:00Z" },
        ],
      }),
    );
    const arb = res.chains[0];
    expect(arb.totalCollateralUsd).toBe(50_000);
    expect(arb.totalDebtUsd).toBe(18_000);
    expect(arb.healthFactor).toBe(1.7);
    // Свежесть — по самой старой проверке
    expect(arb.checkedAt).toBe("2026-07-30T08:00:00Z");
  });
});

describe("settingsSchema (порог HF)", () => {
  it("принимает 1 < x <= 10, отклоняет остальное", () => {
    expect(settingsSchema.safeParse({ hfWarningThreshold: 1.5 }).success).toBe(true);
    expect(settingsSchema.safeParse({ hfWarningThreshold: 10 }).success).toBe(true);
    for (const bad of [1, 0.9, 0, -1, 10.1, "1.5", null]) {
      expect(
        settingsSchema.safeParse({ hfWarningThreshold: bad }).success,
        `порог ${JSON.stringify(bad)}`,
      ).toBe(false);
    }
  });
});
