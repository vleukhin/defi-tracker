import { describe, expect, it } from "vitest";
import { buildSnapshotRows, type SnapshotSource } from "./snapshot";
import type { PortfolioCategory, PortfolioRow } from "./portfolio";

/**
 * Правило is_partial — единственная нетривиальная логика снепшота, и цена
 * ошибки в ней высокая: непомеченная точка, посчитанная по неполным данным,
 * на графике неотличима от настоящего обвала портфеля.
 */

interface RowOverrides {
  amount?: number | null;
  amountUsd?: number;
  price?: number | null;
  priceStale?: boolean;
  percent?: number;
  collateralUsd?: number;
  manualUsd?: number;
  collateralDetail?: PortfolioRow["collateralDetail"];
  manualEntries?: PortfolioRow["manualEntries"];
}

function row(category: PortfolioCategory, o: RowOverrides = {}): PortfolioRow {
  const amountUsd = o.amountUsd ?? 0;
  return {
    category,
    label: category.toUpperCase(),
    unit: category === "stable" ? "USD" : category.toUpperCase(),
    amount: "amount" in o ? (o.amount ?? null) : 0,
    amountUsd,
    price: "price" in o ? (o.price ?? null) : 1,
    priceStale: o.priceStale ?? false,
    percent: o.percent ?? 0,
    targetPercent: null,
    percentDiff: null,
    amountToBalance: null,
    breakdown: {
      collateralUsd: o.collateralUsd ?? 0,
      manualUsd: o.manualUsd ?? amountUsd,
    },
    collateralDetail: o.collateralDetail ?? [],
    manualEntries: o.manualEntries ?? [],
    warnings: [],
  };
}

/** Портфель ~$100k: BTC 50%, ETH 20%, стейблы 30%. */
function healthyPortfolio(): SnapshotSource {
  return {
    totalUsd: 100_000,
    rows: [
      row("btc", {
        amount: 0.5,
        amountUsd: 50_000,
        price: 100_000,
        percent: 50,
        collateralUsd: 50_000,
        manualUsd: 0,
        collateralDetail: [
          {
            walletId: "w1",
            walletLabel: null,
            chain: "arbitrum",
            symbol: "WBTC",
            quantity: "0.5",
            priceUsd: 100_000,
            valueUsd: 50_000,
            priceStale: false,
          },
        ],
      }),
      row("eth", {
        amount: 5,
        amountUsd: 20_000,
        price: 4_000,
        percent: 20,
        manualUsd: 20_000,
      }),
      row("stable", {
        amount: 30_000,
        amountUsd: 30_000,
        price: 1,
        percent: 30,
        manualUsd: 30_000,
      }),
      ],
    chains: [
      { chain: "ethereum", ok: true, error: null, checked_at: "2026-07-30T03:00:00Z" },
      { chain: "arbitrum", ok: true, error: null, checked_at: "2026-07-30T03:00:00Z" },
    ],
  };
}

describe("buildSnapshotRows", () => {
  it("обычный случай: три категории, полный снепшот", () => {
    const build = buildSnapshotRows(healthyPortfolio());

    expect(build.isPartial).toBe(false);
    expect(build.partialReasons).toEqual([]);
    expect(build.totalUsd).toBe(100_000);
    expect(build.items.map((i) => i.category)).toEqual([
      "btc",
      "eth",
      "stable",
    ]);
  });

  it("доли складываются в ~100%, разбивка залог/вручную сохраняется", () => {
    const build = buildSnapshotRows(healthyPortfolio());

    const sum = build.items.reduce((s, i) => s + i.percent, 0);
    expect(sum).toBeCloseTo(100, 6);

    const btc = build.items.find((i) => i.category === "btc")!;
    expect(btc.collateralUsd).toBe(50_000);
    expect(btc.manualUsd).toBe(0);
    expect(btc.valueUsd).toBe(btc.collateralUsd + btc.manualUsd);
  });

  it("отказ чтения сети делает снепшот частичным", () => {
    const source = healthyPortfolio();
    source.chains[1] = {
      chain: "arbitrum",
      ok: false,
      error: "RPC timeout",
      checked_at: "2026-07-30T03:00:00Z",
    };

    const build = buildSnapshotRows(source);

    expect(build.isPartial).toBe(true);
    expect(build.partialReasons.join(" ")).toContain("arbitrum");
    // Снепшот все равно снимается по последним известным данным (S3.1)
    expect(build.totalUsd).toBe(100_000);
    expect(build.items).toHaveLength(3);
  });

  it("устаревшая цена категории делает снепшот частичным", () => {
    const source = healthyPortfolio();
    source.rows[1].priceStale = true;

    const build = buildSnapshotRows(source);

    expect(build.isPartial).toBe(true);
    expect(build.partialReasons.join(" ")).toContain("ETH");
  });

  it("отсутствующая цена категории: quantity = null, не ноль", () => {
    const source = healthyPortfolio();
    source.rows[0].price = null;
    source.rows[0].amount = null;

    const build = buildSnapshotRows(source);

    expect(build.isPartial).toBe(true);
    const btc = build.items.find((i) => i.category === "btc")!;
    expect(btc.quantity).toBeNull();
    expect(btc.priceUsd).toBeNull();
  });

  it("устаревшая цена залогового токена тоже делает снепшот частичным", () => {
    const source = healthyPortfolio();
    source.rows[0].collateralDetail[0].priceStale = true;

    const build = buildSnapshotRows(source);

    expect(build.isPartial).toBe(true);
    expect(build.partialReasons.join(" ")).toContain("WBTC");
  });

  it("пустой портфель: нули, но снепшот полный", () => {
    const source: SnapshotSource = {
      totalUsd: 0,
      rows: [
        row("btc", { amount: 0, price: 100_000 }),
        row("eth", { amount: 0, price: 4_000 }),
        row("stable", { amount: 0, price: 1 }),
      ],
      chains: [],
    };

    const build = buildSnapshotRows(source);

    expect(build.totalUsd).toBe(0);
    expect(build.isPartial).toBe(false);
    expect(build.items).toHaveLength(3);
    expect(build.items.every((i) => i.valueUsd === 0 && i.percent === 0)).toBe(
      true,
    );
  });
});

describe("buildSnapshotRows: сырые количества монет", () => {
  const collateral = [
    {
      walletId: "w1",
      walletLabel: "Основной",
      chain: "ethereum",
      symbol: "WBTC",
      quantity: "0.5",
      priceUsd: 60_000,
      valueUsd: 30_000,
      priceStale: false,
    },
    {
      walletId: "w1",
      walletLabel: "Основной",
      chain: "arbitrum",
      symbol: "cbBTC",
      quantity: "0.25",
      priceUsd: 60_000,
      valueUsd: 15_000,
      priceStale: false,
    },
  ];

  it("сохраняет количества по каждому токену и сети", () => {
    const build = buildSnapshotRows({
      totalUsd: 45_000,
      chains: [],
      rows: [
        row("btc", { amountUsd: 45_000, price: 60_000, amount: 0.75, collateralUsd: 45_000, collateralDetail: collateral }),
        row("eth"),
        row("stable"),
      ],
    });

    expect(build.items[0].composition.collateral).toEqual([
      { symbol: "WBTC", chain: "ethereum", quantity: "0.5" },
      { symbol: "cbBTC", chain: "arbitrum", quantity: "0.25" },
    ]);
  });

  it("сохраняет ручные записи количествами, а не только суммой", () => {
    const build = buildSnapshotRows({
      totalUsd: 35_000,
      chains: [],
      rows: [
        row("btc"),
        row("eth"),
        row("stable", {
          amountUsd: 35_000,
          manualUsd: 35_000,
          manualEntries: [
            { id: "m1", label: "GMX пул", amount: "15000", valueUsd: 15_000 },
            { id: "m2", label: "Aave USDC", amount: "20000", valueUsd: 20_000 },
          ],
        }),
      ],
    });

    expect(build.items[2].composition.manual).toEqual([
      { label: "GMX пул", amount: "15000" },
      { label: "Aave USDC", amount: "20000" },
    ]);
  });

  /**
   * Главное свойство: количество монет невосстановимо задним числом,
   * поэтому пишется даже когда цены нет и quantity вырождается в null.
   */
  it("пишет количества даже без цены, когда quantity === null", () => {
    const build = buildSnapshotRows({
      totalUsd: 0,
      chains: [],
      rows: [
        row("btc", { price: null, amount: null, collateralDetail: collateral }),
        row("eth"),
        row("stable"),
      ],
    });

    expect(build.items[0].quantity).toBeNull();
    expect(build.items[0].composition.collateral).toHaveLength(2);
    expect(build.items[0].composition.collateral[0].quantity).toBe("0.5");
    expect(build.isPartial).toBe(true);
  });
});
