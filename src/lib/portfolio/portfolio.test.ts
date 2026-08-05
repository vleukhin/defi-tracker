import { describe, expect, it } from "vitest";
import {
  computePortfolio,
  validateTargets,
  type CollateralInput,
  type FreeBalanceInput,
  type ManualInput,
  type PriceInput,
} from "./portfolio";

function prices(map: Record<string, number>, stale = false): Map<string, PriceInput> {
  return new Map(
    Object.entries(map).map(([id, priceUsd]) => [
      id,
      { priceUsd, fetchedAt: "2026-07-30T09:00:00.000Z", stale },
    ]),
  );
}

function collateral(over: Partial<CollateralInput> = {}): CollateralInput {
  return {
    walletId: "w1",
    walletLabel: "Основной",
    chain: "ethereum",
    symbol: "WBTC",
    category: "btc",
    coingeckoId: "wrapped-bitcoin",
    quantity: "1",
    ...over,
  };
}

function manual(over: Partial<ManualInput> = {}): ManualInput {
  return { id: "m1", category: "stable", label: "GMX пул", amount: "1000", ...over };
}

function free(over: Partial<FreeBalanceInput> = {}): FreeBalanceInput {
  return {
    key: "w1:ethereum:native",
    walletId: "w1",
    walletLabel: "Основной",
    chain: "ethereum",
    token: "native",
    symbol: "ETH",
    category: "eth",
    coingeckoId: "ethereum",
    quantity: "1",
    funds: null,
    updatedAt: "2026-08-04T09:00:00.000Z",
    ...over,
  };
}

describe("computePortfolio", () => {
  it("всегда возвращает три категории в порядке btc, eth, stable", () => {
    const res = computePortfolio({
      collateral: [],
      manual: [],
      targets: {},
      prices: prices({ bitcoin: 64000, ethereum: 1900 }),
    });
    expect(res.rows.map((r) => r.category)).toEqual(["btc", "eth", "stable"]);
    expect(res.totalUsd).toBe(0);
    // Пустой портфель: доли нулевые, а не NaN
    expect(res.rows.every((r) => r.percent === 0)).toBe(true);
  });

  /**
   * Контрольный пример из таблицы пользователя (ТЗ 02 §2а).
   * Количества заданы так, чтобы стоимости совпали с таблицей точно;
   * допуски нужны потому, что в таблице отображаются округленные цены.
   */
  it("воспроизводит контрольный пример из таблицы", () => {
    const btcPrice = 64310;
    const ethPrice = 1912;
    const res = computePortfolio({
      collateral: [
        collateral({
          symbol: "WBTC",
          category: "btc",
          coingeckoId: "wrapped-bitcoin",
          quantity: String(81098 / btcPrice),
        }),
        collateral({
          symbol: "WETH",
          category: "eth",
          coingeckoId: "weth",
          quantity: String(32355 / ethPrice),
        }),
      ],
      manual: [manual({ category: "stable", amount: "39548" })],
      targets: { btc: 50, eth: 20, stable: 30 },
      prices: prices({
        bitcoin: btcPrice,
        ethereum: ethPrice,
        "wrapped-bitcoin": btcPrice,
        weth: ethPrice,
      }),
    });

    expect(res.totalUsd).toBeCloseTo(153001, 0);

    const [btc, eth, stable] = res.rows;

    expect(btc.amountUsd).toBeCloseTo(81098, 0);
    expect(eth.amountUsd).toBeCloseTo(32355, 0);
    expect(stable.amountUsd).toBeCloseTo(39548, 0);

    // Количества в единицах категории.
    // Погрешность здесь шире, чем по остальным колонкам: количество выведено
    // из округленных таблицей стоимости и цены (32355 / 1912 = 16.9221,
    // тогда как в таблице показано 16.9188). Стоимости, доли, отклонения и
    // количество к ребалансировке при этом совпадают с таблицей точно.
    expect(btc.amount).toBeCloseTo(1.2611, 3);
    expect(eth.amount).toBeCloseTo(16.92, 2);
    expect(stable.amount).toBeCloseTo(39548, 0);

    // Доли, %
    expect(btc.percent).toBeCloseTo(53.0, 1);
    expect(eth.percent).toBeCloseTo(21.15, 1);
    expect(stable.percent).toBeCloseTo(25.85, 1);

    // Отклонения, п.п.
    expect(btc.percentDiff).toBeCloseTo(3.0, 1);
    expect(eth.percentDiff).toBeCloseTo(1.15, 1);
    expect(stable.percentDiff).toBeCloseTo(-4.15, 1);

    // К ребалансировке в единицах категории: минус = продать
    expect(btc.amountToBalance).toBeCloseTo(-0.071486, 3);
    expect(eth.amountToBalance).toBeCloseTo(-0.917713, 2);
    expect(stable.amountToBalance).toBeCloseTo(6352, 0);

    expect(res.targetSumPct).toBe(100);
  });

  it("оценивает wstETH по своей цене, а не как 1 ETH", () => {
    const res = computePortfolio({
      collateral: [
        collateral({
          symbol: "wstETH",
          category: "eth",
          coingeckoId: "wrapped-steth",
          quantity: "10",
        }),
      ],
      manual: [],
      targets: {},
      prices: prices({ ethereum: 1917.09, "wrapped-steth": 2377.85 }),
    });

    const eth = res.rows[1];
    // 10 wstETH = $23 778.50 = 12.4 ETH-эквивалента, а НЕ 10 ETH
    expect(eth.amountUsd).toBeCloseTo(23778.5, 1);
    expect(eth.amount).toBeCloseTo(12.4034, 3);
    expect(eth.amount).toBeGreaterThan(12);
  });

  it("суммирует залог с разных сетей и кошельков в одну категорию", () => {
    const res = computePortfolio({
      collateral: [
        collateral({ chain: "ethereum", quantity: "0.5", walletId: "w1" }),
        collateral({ chain: "arbitrum", quantity: "0.25", walletId: "w2" }),
      ],
      manual: [],
      targets: {},
      prices: prices({ bitcoin: 60000, "wrapped-bitcoin": 60000 }),
    });

    const btc = res.rows[0];
    expect(btc.amountUsd).toBeCloseTo(45000, 6);
    expect(btc.collateralDetail).toHaveLength(2);
    expect(btc.collateralDetail.map((d) => d.chain)).toEqual([
      "ethereum",
      "arbitrum",
    ]);
  });

  it("складывает залог и ручные корректировки, показывая разбивку", () => {
    const res = computePortfolio({
      collateral: [collateral({ quantity: "1" })],
      manual: [manual({ category: "btc", label: "Биржа", amount: "0.5" })],
      targets: {},
      prices: prices({ bitcoin: 60000, "wrapped-bitcoin": 60000 }),
    });

    const btc = res.rows[0];
    expect(btc.breakdown.collateralUsd).toBeCloseTo(60000, 6);
    expect(btc.breakdown.manualUsd).toBeCloseTo(30000, 6);
    expect(btc.amount).toBeCloseTo(1.5, 6);
  });

  it("суммирует несколько записей стейблов", () => {
    const res = computePortfolio({
      collateral: [],
      manual: [
        manual({ id: "m1", label: "GMX пул", amount: "15000" }),
        manual({ id: "m2", label: "Aave USDC", amount: "20000" }),
        manual({ id: "m3", label: "Биржа", amount: "4548" }),
      ],
      targets: {},
      prices: prices({}),
    });

    const stable = res.rows[2];
    expect(stable.amountUsd).toBe(39548);
    expect(stable.manualEntries).toHaveLength(3);
    // Стейблы оцениваются фиксированно по $1 — прайсер не нужен
    expect(stable.price).toBe(1);
  });

  it("без заданной цели не показывает отклонение и количество к ребалансировке", () => {
    const res = computePortfolio({
      collateral: [collateral({ quantity: "1" })],
      manual: [],
      targets: { btc: 100 },
      prices: prices({ bitcoin: 60000, "wrapped-bitcoin": 60000 }),
    });

    expect(res.rows[0].percentDiff).toBeCloseTo(0, 6);
    expect(res.rows[1].targetPercent).toBeNull();
    expect(res.rows[1].percentDiff).toBeNull();
    expect(res.rows[1].amountToBalance).toBeNull();
  });

  it("не оценивает залог без цены в ноль молча, а предупреждает", () => {
    const res = computePortfolio({
      collateral: [
        collateral({ symbol: "FBTC", coingeckoId: "ignition-fbtc", quantity: "2" }),
      ],
      manual: [],
      targets: {},
      prices: prices({ bitcoin: 60000 }), // цены FBTC нет
    });

    const btc = res.rows[0];
    expect(btc.warnings.join(" ")).toContain("FBTC");
    expect(btc.collateralDetail[0].priceUsd).toBeNull();
  });

  it("при отсутствии цены категории не выдумывает количество", () => {
    const res = computePortfolio({
      collateral: [],
      manual: [manual({ category: "btc", label: "Биржа", amount: "1" })],
      targets: { btc: 50 },
      prices: prices({}), // нет цены bitcoin даже устаревшей
    });

    const btc = res.rows[0];
    expect(btc.price).toBeNull();
    expect(btc.amount).toBeNull();
    expect(btc.amountToBalance).toBeNull();
    expect(btc.warnings.length).toBeGreaterThan(0);
  });

  it("прокидывает устаревание цен наружу", () => {
    const res = computePortfolio({
      collateral: [collateral({ quantity: "1" })],
      manual: [],
      targets: {},
      prices: prices({ bitcoin: 60000, "wrapped-bitcoin": 60000 }, true),
    });

    expect(res.anyPriceStale).toBe(true);
    expect(res.rows[0].priceStale).toBe(true);
    expect(res.oldestPriceAt).toBe("2026-07-30T09:00:00.000Z");
  });

  it("не теряет точность на количествах с 8 знаками", () => {
    const res = computePortfolio({
      collateral: [collateral({ quantity: "0.00000001" })],
      manual: [],
      targets: {},
      prices: prices({ bitcoin: 64000, "wrapped-bitcoin": 64000 }),
    });
    // 1 сатоши по $64k = $0.00064
    expect(res.rows[0].amountUsd).toBeCloseTo(0.00064, 8);
  });
});

describe("validateTargets", () => {
  it("сумма 100 — без предупреждения", () => {
    const res = validateTargets([
      { category: "btc", targetPct: 50 },
      { category: "eth", targetPct: 20 },
      { category: "stable", targetPct: 30 },
    ]);
    expect(res.sumPct).toBe(100);
    expect(res.warning).toBeNull();
  });

  it("сумма ≠ 100 — предупреждение, но данные принимаются", () => {
    const res = validateTargets([
      { category: "btc", targetPct: 50 },
      { category: "eth", targetPct: 20 },
    ]);
    expect(res.sumPct).toBe(70);
    expect(res.warning).toContain("70");
  });

  it("пустой набор целей допустим", () => {
    expect(validateTargets([])).toEqual({ sumPct: 0, warning: null });
  });
});

/**
 * Свободные средства на кошельке (Фаза 7).
 *
 * Главное, что здесь проверяется, — почему это отдельный вход, а не ручная
 * запись: ручная запись оценивается по цене КАТЕГОРИИ, свободный баланс —
 * по своей.
 */
describe("computePortfolio: свободные средства", () => {
  it("оценивает свободный wstETH по СВОЕЙ цене, а не по цене ETH", () => {
    const res = computePortfolio({
      collateral: [],
      manual: [],
      free: [
        free({
          symbol: "wstETH",
          token: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
          coingeckoId: "wrapped-steth",
          quantity: "1",
        }),
      ],
      targets: {},
      prices: prices({ ethereum: 2000, "wrapped-steth": 2480 }),
    });
    const eth = res.rows.find((r) => r.category === "eth")!;
    expect(eth.breakdown.freeUsd).toBe(2480);
    // Количество категории — ETH-эквивалент: 2480 / 2000 = 1.24 ETH.
    // Через ручную запись здесь получился бы ровно 1 ETH, то есть −24%
    expect(eth.amount).toBeCloseTo(1.24, 10);
  });

  it("заемные не входят в категорию, но остаются в списке", () => {
    const res = computePortfolio({
      collateral: [],
      manual: [],
      free: [
        free({
          key: "w1:arbitrum:0xaf88",
          symbol: "USDC",
          token: "0xaf88",
          chain: "arbitrum",
          category: "stable",
          coingeckoId: "usd-coin",
          quantity: "20000",
          funds: "borrowed",
        }),
        free({
          key: "w1:arbitrum:0xff",
          symbol: "USDT",
          token: "0xff",
          chain: "arbitrum",
          category: "stable",
          coingeckoId: "tether",
          quantity: "5000",
          funds: "own",
        }),
      ],
      targets: {},
      prices: prices({ bitcoin: 64000, ethereum: 2000 }),
    });
    const stable = res.rows.find((r) => r.category === "stable")!;
    expect(stable.breakdown.freeUsd).toBe(5000);
    expect(stable.amountUsd).toBe(5000);
    // Заемный виден в списке, просто не посчитан
    expect(stable.freeBalances).toHaveLength(2);
    expect(stable.freeBalances.find((b) => b.symbol === "USDC")).toMatchObject({
      valueUsd: 20_000,
      countedInCategory: false,
    });
    expect(res.freeBorrowedUsd).toBe(20_000);
    expect(res.freeOwnUsd).toBe(5000);
  });

  it("неразмеченный считается своим, но попадает в счетчик", () => {
    const res = computePortfolio({
      collateral: [],
      manual: [],
      free: [
        free({ category: "stable", symbol: "USDC", quantity: "3000", funds: null }),
      ],
      targets: {},
      prices: prices({ bitcoin: 64000, ethereum: 2000 }),
    });
    const stable = res.rows.find((r) => r.category === "stable")!;
    expect(stable.breakdown.freeUsd).toBe(3000);
    expect(res.unmarkedFreeCount).toBe(1);
    expect(res.freeBorrowedUsd).toBe(0);
  });

  it("пыль ниже порога уходит в freeDust, а не молча в ноль", () => {
    const res = computePortfolio({
      collateral: [],
      manual: [],
      free: [
        // 0,0001 ETH ≈ $0,20 — газовая сдача на четвертой сети
        free({ quantity: "0.0001" }),
        free({ key: "w1:base:native", chain: "base", quantity: "5" }),
      ],
      targets: {},
      prices: prices({ ethereum: 2000 }),
    });
    const eth = res.rows.find((r) => r.category === "eth")!;
    expect(eth.freeBalances).toHaveLength(1);
    expect(res.freeDust.count).toBe(1);
    expect(res.freeDust.valueUsd).toBeCloseTo(0.2, 10);
    // Пыль не размечена, но в счетчик неразмеченных не идет: просить
    // разметить $0,20 — шум
    expect(res.unmarkedFreeCount).toBe(1);
  });

  it("токен вне трех категорий не оценивается и в портфель не входит", () => {
    const res = computePortfolio({
      collateral: [],
      manual: [],
      free: [
        free({
          symbol: "LINK",
          token: "0x5149",
          category: null,
          coingeckoId: "chainlink",
          quantity: "12",
        }),
      ],
      targets: {},
      prices: prices({ ethereum: 2000, chainlink: 15 }),
    });
    expect(res.totalUsd).toBe(0);
    expect(res.freeOther).toEqual([
      {
        walletId: "w1",
        walletLabel: "Основной",
        chain: "ethereum",
        symbol: "LINK",
        quantity: "12",
      },
    ]);
  });

  it("баланс без цены дает предупреждение, а не тихий ноль", () => {
    const res = computePortfolio({
      collateral: [],
      manual: [],
      free: [free({ symbol: "cbETH", coingeckoId: "coinbase-wrapped-staked-eth" })],
      targets: {},
      prices: prices({ ethereum: 2000 }),
    });
    const eth = res.rows.find((r) => r.category === "eth")!;
    expect(eth.warnings.join(" ")).toContain("cbETH");
    // Без цены баланс оценивается в 0 и потому уходит в пыль — но не молча:
    // предупреждение уже выставлено
    expect(res.freeDust.count).toBe(1);
  });

  it("без входа free результат прежний: freeUsd = 0, счетчики пустые", () => {
    const res = computePortfolio({
      collateral: [collateral()],
      manual: [manual()],
      targets: {},
      prices: prices({ bitcoin: 64000, ethereum: 2000, "wrapped-bitcoin": 64000 }),
    });
    expect(res.totalUsd).toBe(65_000);
    expect(res.rows.every((r) => r.breakdown.freeUsd === 0)).toBe(true);
    expect(res.freeBorrowedUsd).toBe(0);
    expect(res.freeOther).toEqual([]);
    expect(res.freeDust).toEqual({ count: 0, valueUsd: 0 });
  });
});
