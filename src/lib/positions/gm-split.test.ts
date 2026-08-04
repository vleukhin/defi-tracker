import { describe, expect, it } from "vitest";
import type { PositionDto } from "@/lib/api/types";
import { gmMarketCategory, gmShare } from "./gm-split";

/**
 * Сплит внутри GM (docs/07 §8): 70% BTC/USDC и 30% ETH/USDC. Доля считается
 * по стоимости пулов — вложенное к сегодняшней пропорции отношения не имеет.
 */
function gm(
  id: string,
  longSymbol: string,
  valueUsd: number | null,
): PositionDto {
  return {
    id,
    protocol: "gmx_v2",
    protocolLabel: "GMX v2",
    chain: "arbitrum",
    zone: "yield",
    zoneKey: `gmx_v2:arbitrum:${id}`,
    ownPrincipalUsd: null,
    borrowedPrincipalUsd: null,
    withdrawnUsd: null,
    entryPriceUsd: null,
    ownCurrentUsd: 0,
    profitUsd: null,
    profitPct: null,
    title: `GM ${longSymbol}`,
    subtitle: null,
    quantity: "1",
    valueUsd,
    components: [
      { symbol: longSymbol, quantity: 1, valueUsd, side: "long" },
      { symbol: "USDC", quantity: 1, valueUsd: 1, side: "short" },
    ],
    feesUsd: null,
    fees24hUsd: null,
    fees24hReason: null,
    inRange: null,
    outOfRangeSince: null,
    range: null,
    supplyRatePercent: null,
    rewardsRatePercent: null,
    walletId: "w",
    walletLabel: null,
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("gmMarketCategory", () => {
  it("рынок определяется long-стороной, а не стейблом", () => {
    expect(gmMarketCategory(gm("1", "BTC", 1))).toBe("btc");
    expect(gmMarketCategory(gm("2", "WETH", 1))).toBe("eth");
    // Рынок вне двух базовых активов цели по стратегии не имеет
    expect(gmMarketCategory(gm("3", "SOL", 1))).toBeNull();
  });
});

describe("gmShare", () => {
  it("доля считается от стоимости всех GM-пулов", () => {
    const btc = gm("1", "BTC", 7_000);
    const eth = gm("2", "WETH", 3_000);
    const share = gmShare(btc, [btc, eth]);

    expect(share.totalUsd).toBe(10_000);
    expect(share.sharePercent).toBeCloseTo(70, 9);
    expect(share.targetPercent).toBe(70);
    expect(share.deviationPp).toBeCloseTo(0, 9);
  });

  it("перекос виден отклонением в п.п.", () => {
    const btc = gm("1", "BTC", 8_500);
    const eth = gm("2", "WETH", 1_500);
    expect(gmShare(eth, [btc, eth]).deviationPp).toBeCloseTo(-15, 9);
  });

  it("неоцененный пул делает неизвестной и сумму, и долю", () => {
    // Доля от части пулов вводила бы в заблуждение сильнее, чем прочерк
    const btc = gm("1", "BTC", 7_000);
    const eth = gm("2", "WETH", null);
    const share = gmShare(btc, [btc, eth]);

    expect(share.totalUsd).toBeNull();
    expect(share.sharePercent).toBeNull();
    expect(share.deviationPp).toBeNull();
  });

  it("позиции других протоколов в сумму GM не входят", () => {
    const btc = gm("1", "BTC", 7_000);
    const lp = { ...gm("2", "WETH", 3_000), protocol: "uni_v3" as const };
    expect(gmShare(btc, [btc, lp]).sharePercent).toBeCloseTo(100, 9);
  });

  it("рынок без цели по стратегии — доля есть, цели нет", () => {
    const sol = gm("1", "SOL", 1_000);
    const share = gmShare(sol, [sol]);
    expect(share.sharePercent).toBeCloseTo(100, 9);
    expect(share.targetPercent).toBeNull();
    expect(share.deviationPp).toBeNull();
  });
});
