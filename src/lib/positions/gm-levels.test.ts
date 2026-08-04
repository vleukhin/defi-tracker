import { describe, expect, it } from "vitest";
import type { PositionDto } from "@/lib/api/types";
import { gmLevels, gmMarketPriceUsd } from "./gm-levels";

/**
 * Уровни действий по GM (docs/07 §5): −7 / −15 / −30 / −50 / −70 от точки
 * отсчёта, заданной разметкой. Ключевое, что здесь проверяется: уровни
 * считаются от ЦЕНЫ базового актива, а не от стоимости позиции, и без
 * точки отсчёта не считаются вовсе.
 */
function gm({
  entryPriceUsd = null,
  longQuantity = 1,
  longValueUsd = 100_000,
}: {
  entryPriceUsd?: number | null;
  longQuantity?: number;
  longValueUsd?: number | null;
} = {}): PositionDto {
  return {
    id: "p1",
    protocol: "gmx_v2",
    protocolLabel: "GMX v2",
    chain: "arbitrum",
    zone: "yield",
    zoneKey: "gmx_v2:arbitrum:p1",
    ownPrincipalUsd: null,
    borrowedPrincipalUsd: null,
    withdrawnUsd: null,
    entryPriceUsd,
    ownCurrentUsd: 0,
    profitUsd: null,
    profitPct: null,
    title: "GM BTC",
    subtitle: "BTC/USD [BTC-USDC]",
    quantity: "1",
    valueUsd: 20_000,
    components: [
      {
        symbol: "BTC",
        quantity: longQuantity,
        valueUsd: longValueUsd,
        side: "long",
      },
      { symbol: "USDC", quantity: 10_000, valueUsd: 10_000, side: "short" },
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
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
}

describe("цена базового актива", () => {
  it("берётся с длинной стороны пула — короткая всегда стейбл", () => {
    expect(gmMarketPriceUsd(gm({ longQuantity: 0.5, longValueUsd: 45_000 }))).toBe(
      90_000,
    );
  });

  it("нулевая стоимость компонента — это «цены не было», а не цена ноль", () => {
    // Читатель GMX пишет 0, когда оракульной цены токена не оказалось
    expect(gmMarketPriceUsd(gm({ longValueUsd: 0 }))).toBeNull();
    expect(gmMarketPriceUsd(gm({ longValueUsd: null }))).toBeNull();
  });
});

describe("без точки отсчёта уровни не считаются", () => {
  it("пустой список вместо выдуманной шкалы", () => {
    const v = gmLevels(gm({ entryPriceUsd: null }));
    expect(v.levels).toEqual([]);
    expect(v.changePercent).toBeNull();
    expect(v.reachedCount).toBeNull();
    expect(v.growth).toBeNull();
    // Цена при этом известна — не знаем мы именно точку отсчёта
    expect(v.currentPriceUsd).toBe(100_000);
  });
});

describe("шкала уровней", () => {
  it("цены уровней считаются от точки отсчёта, а не от текущей цены", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 80_000 }));
    expect(v.levels.map((l) => l.priceUsd)).toEqual([
      93_000, 85_000, 70_000, 50_000, 30_000,
    ]);
  });

  it("пройденными считаются уровни не выше текущей цены", () => {
    // Точка отсчёта 100 000, цена 84 000 — это −16%: −7 и −15 позади
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 84_000 }));
    expect(v.changePercent).toBeCloseTo(-16, 10);
    expect(v.reachedCount).toBe(2);
    expect(v.lastReached?.dropPercent).toBe(15);
    expect(v.nextLevel?.dropPercent).toBe(30);
  });

  it("на самой цене уровня уровень уже пройден", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 93_000 }));
    expect(v.lastReached?.dropPercent).toBe(7);
    expect(v.nextLevel?.dropPercent).toBe(15);
  });

  it("выше точки отсчёта пройденных уровней нет", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 110_000 }));
    expect(v.reachedCount).toBe(0);
    expect(v.lastReached).toBeNull();
    expect(v.nextLevel?.dropPercent).toBe(7);
    expect(v.changePercent).toBeCloseTo(10, 10);
  });

  it("ниже последнего уровня ближайшего впереди уже нет", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 20_000 }));
    expect(v.reachedCount).toBe(5);
    expect(v.nextLevel).toBeNull();
    expect(v.toNextPercent).toBeNull();
  });

  it("до ближайшего уровня считается от сегодняшней цены, а не в п.п.", () => {
    // От −7% до −15%: цене 93 000 остаётся упасть до 85 000 — это 8,6%,
    // а не 8 «процентных пунктов разницы уровней»
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 93_000 }));
    expect(v.toNextPercent).toBeCloseTo(8.602, 3);
  });

  it("действия уровня — из таблиц §5, вместе с Stability на глубоких", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000 }));
    expect(v.levels[0].stabilityAction).toBeNull();
    expect(v.levels[1].stabilityAction).toBeNull();
    expect(v.levels[2].stabilityAction).toContain("30% всей зоны");
    expect(v.levels[4].stabilityAction).toContain("оставшиеся 30%");
    expect(v.levels[0].action).toContain("на 30%");
  });
});

describe("неизвестная цена не выдаётся за «уровень не пройден»", () => {
  it("статусы уровней null, а шкала всё равно показывается", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 0 }));
    expect(v.currentPriceUsd).toBeNull();
    expect(v.levels).toHaveLength(5);
    expect(v.levels.every((l) => l.reached === null)).toBe(true);
    expect(v.reachedCount).toBeNull();
    expect(v.nextLevel).toBeNull();
    expect(v.growth?.reached).toBeNull();
  });
});

describe("рост", () => {
  it("ориентир первой фиксации — +50% от точки отсчёта (§6)", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 160_000 }));
    expect(v.growth?.priceUsd).toBe(150_000);
    expect(v.growth?.reached).toBe(true);
  });
});
