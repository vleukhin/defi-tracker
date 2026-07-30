import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { BUILTIN_BUCKET_IDS } from "@/lib/chains/allowlist";
import {
  computeAllocation,
  resolveBucketMap,
  validateTargets,
  type AllocationInput,
  type BucketInfo,
  type HoldingInput,
  type PriceEntry,
} from "./allocation";

const { BTC, ETH, STABLE, OTHER } = BUILTIN_BUCKET_IDS;

const BUCKETS: BucketInfo[] = [
  { id: BTC, name: "BTC", builtin: true },
  { id: ETH, name: "ETH", builtin: true },
  { id: STABLE, name: "Stablecoins", builtin: true },
  { id: OTHER, name: "Прочее", builtin: true },
];

const T0 = "2026-07-30T10:00:00.000Z";

function holding(partial: Partial<HoldingInput> & Pick<HoldingInput, "assetId" | "symbol" | "raw">): HoldingInput {
  return {
    walletId: "wallet-1",
    walletLabel: "Основной",
    chain: "ethereum",
    decimals: 18,
    coingeckoId: null,
    balanceUpdatedAt: T0,
    ...partial,
  };
}

function price(priceUsd: number, over: Partial<PriceEntry> = {}): PriceEntry {
  return { priceUsd, fetchedAt: T0, stale: false, ...over };
}

function compute(over: Partial<AllocationInput>): ReturnType<typeof computeAllocation> {
  return computeAllocation({
    holdings: [],
    prices: new Map(),
    buckets: BUCKETS,
    bucketMap: [],
    targets: [],
    ...over,
  });
}

describe("computeAllocation: слияние мульти-чейн (S1.5)", () => {
  it("ETH на 2 сетях + WETH в 2 кошельках -> одна строка ETH с разбивкой по источникам", () => {
    const holdings = [
      holding({ assetId: "eth-mainnet", symbol: "ETH", coingeckoId: "ethereum", raw: parseUnits("1", 18), chain: "ethereum" }),
      holding({ assetId: "eth-arb", symbol: "ETH", coingeckoId: "ethereum", raw: parseUnits("0.5", 18), chain: "arbitrum" }),
      holding({ assetId: "weth-base", symbol: "WETH", coingeckoId: "weth", raw: parseUnits("0.25", 18), chain: "base", walletId: "wallet-1" }),
      holding({ assetId: "weth-base", symbol: "WETH", coingeckoId: "weth", raw: parseUnits("0.25", 18), chain: "base", walletId: "wallet-2", walletLabel: "Ledger" }),
    ];
    const prices = new Map([
      ["eth-mainnet", price(2000)],
      ["eth-arb", price(2000)],
      ["weth-base", price(2000)],
    ]);
    const bucketMap = [
      { assetId: "eth-mainnet", bucketId: ETH, userId: null },
      { assetId: "eth-arb", bucketId: ETH, userId: null },
      { assetId: "weth-base", bucketId: ETH, userId: null },
    ];

    const res = compute({ holdings, prices, bucketMap });

    expect(res.buckets).toHaveLength(1);
    const ethBucket = res.buckets[0];
    expect(ethBucket.name).toBe("ETH");
    expect(ethBucket.assets).toHaveLength(1);

    const row = ethBucket.assets[0];
    expect(row.symbol).toBe("ETH");
    expect(row.quantity).toBe("2"); // 1 + 0.5 + 0.25 + 0.25
    expect(row.valueUsd).toBe(4000);
    expect(row.sources).toHaveLength(4); // кошелек x сеть
    expect(res.totalUsd).toBe(4000);
  });

  it("один и тот же токен (coingecko id) на разных сетях — один актив", () => {
    const holdings = [
      holding({ assetId: "usdc-eth", symbol: "USDC", coingeckoId: "usd-coin", decimals: 6, raw: 100_000_000n, chain: "ethereum" }),
      holding({ assetId: "usdc-arb", symbol: "USDC", coingeckoId: "usd-coin", decimals: 6, raw: 50_000_000n, chain: "arbitrum" }),
    ];
    const prices = new Map([
      ["usdc-eth", price(1)],
      ["usdc-arb", price(1)],
    ]);
    const bucketMap = [
      { assetId: "usdc-eth", bucketId: STABLE, userId: null },
      { assetId: "usdc-arb", bucketId: STABLE, userId: null },
    ];

    const res = compute({ holdings, prices, bucketMap });
    expect(res.buckets[0].assets).toHaveLength(1);
    expect(res.buckets[0].assets[0].quantity).toBe("150");
    expect(res.buckets[0].assets[0].assetIds).toEqual(["usdc-arb", "usdc-eth"]);
  });

  it("слияние с разными decimals нормализуется без потерь (bigint)", () => {
    // Синтетический кейс: один cg id, decimals 6 и 18
    const holdings = [
      holding({ assetId: "a6", symbol: "TKN", coingeckoId: "tkn", decimals: 6, raw: 1_500_000n }),
      holding({ assetId: "a18", symbol: "TKN", coingeckoId: "tkn", decimals: 18, raw: parseUnits("2.5", 18), chain: "base" }),
    ];
    const prices = new Map([
      ["a6", price(10)],
      ["a18", price(10)],
    ]);
    const res = compute({ holdings, prices });
    const row = res.buckets[0].assets[0];
    expect(row.quantity).toBe("4"); // 1.5 + 2.5
    expect(res.buckets[0].bucketId).toBe(OTHER);
  });
});

describe("computeAllocation: USDC vs USDC.e (S1.3)", () => {
  it("не сливает USDC и USDC.e — разные строки", () => {
    const holdings = [
      holding({ assetId: "usdc-arb", symbol: "USDC", coingeckoId: "usd-coin", decimals: 6, raw: 100_000_000n, chain: "arbitrum" }),
      holding({ assetId: "usdce-arb", symbol: "USDC.e", coingeckoId: "usd-coin-ethereum-bridged", decimals: 6, raw: 200_000_000n, chain: "arbitrum" }),
    ];
    const prices = new Map([
      ["usdc-arb", price(1)],
      ["usdce-arb", price(0.999)],
    ]);
    const bucketMap = [
      { assetId: "usdc-arb", bucketId: STABLE, userId: null },
      { assetId: "usdce-arb", bucketId: STABLE, userId: null },
    ];

    const res = compute({ holdings, prices, bucketMap });
    const symbols = res.buckets[0].assets.map((a) => a.symbol).sort();
    expect(symbols).toEqual(["USDC", "USDC.e"]);
    expect(res.buckets[0].assets).toHaveLength(2);
  });
});

describe("computeAllocation: WETH -> корзина ETH и override (S1.6)", () => {
  const holdings = [
    holding({ assetId: "weth-eth", symbol: "WETH", coingeckoId: "weth", raw: parseUnits("1", 18) }),
    holding({ assetId: "wbtc-eth", symbol: "WBTC", coingeckoId: "wrapped-bitcoin", decimals: 8, raw: 100_000_000n }),
  ];
  const prices = new Map([
    ["weth-eth", price(2000)],
    ["wbtc-eth", price(60000)],
  ]);
  const defaultMap = [
    { assetId: "weth-eth", bucketId: ETH, userId: null },
    { assetId: "wbtc-eth", bucketId: BTC, userId: null },
  ];

  it("дефолтный маппинг: WETH в корзине ETH, WBTC в BTC", () => {
    const res = compute({ holdings, prices, bucketMap: defaultMap });
    const eth = res.buckets.find((b) => b.bucketId === ETH)!;
    const btc = res.buckets.find((b) => b.bucketId === BTC)!;
    expect(eth.valueUsd).toBe(2000);
    expect(eth.assets[0].symbol).toBe("ETH"); // WETH отождествлен с ETH
    expect(btc.valueUsd).toBe(60000);
  });

  it("override пользователя перекрывает дефолт и отменяет слияние WETH->ETH", () => {
    const custom = "11111111-1111-1111-1111-111111111111";
    const res = compute({
      holdings,
      prices,
      buckets: [...BUCKETS, { id: custom, name: "L2-альты", builtin: false }],
      bucketMap: [...defaultMap, { assetId: "weth-eth", bucketId: custom, userId: "user-1" }],
    });
    const customBucket = res.buckets.find((b) => b.bucketId === custom)!;
    expect(customBucket.valueUsd).toBe(2000);
    expect(customBucket.assets[0].symbol).toBe("WETH");
    expect(res.buckets.find((b) => b.bucketId === ETH)).toBeUndefined();
  });

  it("актив без маппинга попадает в «Прочее»", () => {
    const res = compute({
      holdings: [holding({ assetId: "arb", symbol: "ARB", coingeckoId: "arbitrum", raw: parseUnits("10", 18) })],
      prices: new Map([["arb", price(1)]]),
    });
    expect(res.buckets[0].bucketId).toBe(OTHER);
    expect(res.buckets[0].name).toBe("Прочее");
    expect(res.buckets[0].targetPct).toBeNull();
  });
});

describe("computeAllocation: отклонения и ребалансировка (S1.7)", () => {
  it("считает %, отклонение в п.п. и сумму ребалансировки по формулам ТЗ", () => {
    const holdings = [
      holding({ assetId: "wbtc", symbol: "WBTC", coingeckoId: "wrapped-bitcoin", decimals: 8, raw: 10_000_000n }), // 0.1 WBTC
      holding({ assetId: "eth", symbol: "ETH", coingeckoId: "ethereum", raw: parseUnits("2", 18) }),
    ];
    const prices = new Map([
      ["wbtc", price(60000)], // $6000
      ["eth", price(2000)], // $4000
    ]);
    const bucketMap = [
      { assetId: "wbtc", bucketId: BTC, userId: null },
      { assetId: "eth", bucketId: ETH, userId: null },
    ];
    const targets = [
      { bucketId: BTC, targetPct: 50 },
      { bucketId: ETH, targetPct: 50 },
    ];

    const res = compute({ holdings, prices, bucketMap, targets });
    expect(res.totalUsd).toBe(10000);

    const btc = res.buckets.find((b) => b.bucketId === BTC)!;
    expect(btc.currentPct).toBe(60);
    expect(btc.deviationPp).toBe(10); // 60 - 50
    expect(btc.rebalanceUsd).toBe(-1000); // 0.5*10000 - 6000 => продать $1000

    const eth = res.buckets.find((b) => b.bucketId === ETH)!;
    expect(eth.deviationPp).toBe(-10);
    expect(eth.rebalanceUsd).toBe(1000); // купить $1000

    expect(res.maxDeviation).toEqual({
      bucketId: BTC,
      name: "BTC",
      deviationPp: 10,
      amountUsd: 1000, // $1000 сверх цели
    });
  });

  it("корзина с целью, но без активов, отображается с rebalance = покупка", () => {
    const holdings = [
      holding({ assetId: "eth", symbol: "ETH", coingeckoId: "ethereum", raw: parseUnits("1", 18) }),
    ];
    const res = compute({
      holdings,
      prices: new Map([["eth", price(1000)]]),
      bucketMap: [{ assetId: "eth", bucketId: ETH, userId: null }],
      targets: [
        { bucketId: ETH, targetPct: 60 },
        { bucketId: BTC, targetPct: 40 },
      ],
    });
    const btc = res.buckets.find((b) => b.bucketId === BTC)!;
    expect(btc.valueUsd).toBe(0);
    expect(btc.currentPct).toBe(0);
    expect(btc.deviationPp).toBe(-40);
    expect(btc.rebalanceUsd).toBe(400);
  });
});

describe("validateTargets: сумма процентов (S1.6)", () => {
  it("предупреждает при сумме != 100, не блокируя", () => {
    const { sumPct, warning } = validateTargets([
      { bucketId: BTC, targetPct: 40 },
      { bucketId: ETH, targetPct: 40 },
    ]);
    expect(sumPct).toBe(80);
    expect(warning).toContain("80");
  });

  it("нет предупреждения при 100 и при пустом списке", () => {
    expect(
      validateTargets([
        { bucketId: BTC, targetPct: 60.5 },
        { bucketId: ETH, targetPct: 39.5 },
      ]).warning,
    ).toBeNull();
    expect(validateTargets([]).warning).toBeNull();
  });
});

describe("computeAllocation: пустой портфель и нулевые балансы", () => {
  it("пустой портфель не падает", () => {
    const res = compute({});
    expect(res.totalUsd).toBe(0);
    expect(res.buckets).toEqual([]);
    expect(res.unrecognized).toEqual([]);
    expect(res.hidden).toEqual([]);
    expect(res.maxDeviation).toBeNull();
    expect(res.freshness.oldestBalanceAt).toBeNull();
  });

  it("нулевые балансы отбрасываются", () => {
    const res = compute({
      holdings: [holding({ assetId: "eth", symbol: "ETH", coingeckoId: "ethereum", raw: 0n })],
      prices: new Map([["eth", price(2000)]]),
    });
    expect(res.totalUsd).toBe(0);
    expect(res.buckets).toEqual([]);
  });
});

describe("computeAllocation: нераспознанные и пыль (S1.4)", () => {
  it("актив без цены -> «Нераспознанные», исключен из итогов", () => {
    const res = compute({
      holdings: [
        holding({ assetId: "eth", symbol: "ETH", coingeckoId: "ethereum", raw: parseUnits("1", 18) }),
        holding({ assetId: "atoken", symbol: "aUSDC", coingeckoId: null, decimals: 6, raw: 5_000_000_000n }),
      ],
      prices: new Map([["eth", price(2000)]]),
      bucketMap: [{ assetId: "eth", bucketId: ETH, userId: null }],
    });
    expect(res.totalUsd).toBe(2000); // aUSDC не в итоге
    expect(res.unrecognized).toHaveLength(1);
    expect(res.unrecognized[0].symbol).toBe("aUSDC");
    expect(res.unrecognized[0].valueUsd).toBeNull();
    expect(res.unrecognized[0].quantity).toBe("5000");
  });

  it("стоимость < $1 -> скрыто, исключено из итогов", () => {
    const res = compute({
      holdings: [
        holding({ assetId: "eth", symbol: "ETH", coingeckoId: "ethereum", raw: parseUnits("1", 18) }),
        holding({ assetId: "dust", symbol: "SHIB", coingeckoId: "shiba-inu", raw: parseUnits("10", 18) }),
      ],
      prices: new Map([
        ["eth", price(2000)],
        ["dust", price(0.00001)], // $0.0001
      ]),
      bucketMap: [{ assetId: "eth", bucketId: ETH, userId: null }],
    });
    expect(res.totalUsd).toBe(2000);
    expect(res.hidden).toHaveLength(1);
    expect(res.hidden[0].symbol).toBe("SHIB");
    expect(res.buckets).toHaveLength(1); // только ETH
  });

  it("порог пыли настраиваем", () => {
    const res = compute({
      holdings: [holding({ assetId: "x", symbol: "X", coingeckoId: "x", raw: parseUnits("1", 18) })],
      prices: new Map([["x", price(5)]]),
      dustThresholdUsd: 10,
    });
    expect(res.hidden).toHaveLength(1);
    expect(res.totalUsd).toBe(0);
  });
});

describe("computeAllocation: свежесть данных (S1.7)", () => {
  it("отдает самые старые таймстемпы балансов и цен", () => {
    const res = compute({
      holdings: [
        holding({ assetId: "a", symbol: "A", coingeckoId: "a", raw: 1n, decimals: 0, balanceUpdatedAt: "2026-07-30T09:00:00.000Z" }),
        holding({ assetId: "b", symbol: "B", coingeckoId: "b", raw: 1n, decimals: 0, balanceUpdatedAt: "2026-07-30T08:00:00.000Z" }),
      ],
      prices: new Map([
        ["a", price(10, { fetchedAt: "2026-07-30T09:58:00.000Z" })],
        ["b", price(10, { fetchedAt: "2026-07-30T09:55:00.000Z", stale: true })],
      ]),
    });
    expect(res.freshness.oldestBalanceAt).toBe("2026-07-30T08:00:00.000Z");
    expect(res.freshness.oldestPriceAt).toBe("2026-07-30T09:55:00.000Z");
    const rows = res.buckets[0].assets;
    expect(rows.find((r) => r.key === "b")!.priceStale).toBe(true);
  });
});

describe("resolveBucketMap", () => {
  it("override пользователя приоритетнее дефолта", () => {
    const map = resolveBucketMap([
      { assetId: "a", bucketId: ETH, userId: null },
      { assetId: "a", bucketId: BTC, userId: "u1" },
      { assetId: "b", bucketId: STABLE, userId: null },
    ]);
    expect(map.get("a")).toBe(BTC);
    expect(map.get("b")).toBe(STABLE);
  });
});
