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
}

function row(category: PortfolioCategory, o: RowOverrides = {}): PortfolioRow {
  const amountUsd = o.amountUsd ?? 0;
  return {
    category,
    label: category.toUpperCase(),
    unit: category === "stable" ? "USD" : category.toUpperCase(),
    amount: o.amount ?? 0,
    amountUsd,
    price: o.price ?? 1,
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
    manualEntries: [],
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
