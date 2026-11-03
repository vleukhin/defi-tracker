import { describe, expect, it } from "vitest";
import { historicalGmxApiData } from "./historical-source";
import { gmxPriceToUsd, type GmxApiData } from "@/lib/prices/gmx-api";
import type { PriceInput } from "./portfolio";

/**
 * GM-пул — единственная позиция, которую нельзя оценить одним лишь архивным
 * чтением: getMarketTokenPrice принимает цены токенов АРГУМЕНТАМИ, а отдаёт
 * их API только текущие. Поэтому цены подменяются историческими, и важно,
 * чтобы подмена была полной или честно отсутствовала.
 */

const WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const EXOTIC = "0x0000000000000000000000000000000000009999";

function apiData(): GmxApiData {
  return {
    decimals: new Map([
      [WETH, 18],
      [USDC, 6],
      [EXOTIC, 18],
    ]),
    symbols: new Map([
      [WETH, "WETH"],
      [USDC, "USDC"],
      [EXOTIC, "ZZZ"],
    ]),
    markets: new Map(),
    // Сегодняшние цены оракула: ETH вдвое дороже исторического
    prices: new Map([
      [WETH, { min: 8_000n * 10n ** 12n, max: 8_000n * 10n ** 12n }],
      [USDC, { min: 10n ** 24n, max: 10n ** 24n }],
      [EXOTIC, { min: 1n, max: 1n }],
    ]),
  };
}

const price = (priceUsd: number): PriceInput => ({
  priceUsd,
  fetchedAt: "2026-10-26T03:00:00.000Z",
  stale: false,
});

describe("historicalGmxApiData", () => {
  it("заменяет оракульные цены историческими", () => {
    const patched = historicalGmxApiData(
      apiData(),
      new Map([
        ["ethereum", price(4000)],
        ["usd-coin", price(0.9998)],
      ]),
    );

    expect(gmxPriceToUsd(patched.prices.get(WETH)!.min, 18)).toBeCloseTo(4000, 6);
    expect(gmxPriceToUsd(patched.prices.get(USDC)!.min, 6)).toBeCloseTo(0.9998, 6);
  });

  it("убирает токен, которому исторической цены не нашлось", () => {
    // Читатель на это и рассчитывает: без цены он не отправляет вызов вовсе
    // и помечает рынок как unpriced. Оставить тут сегодняшнюю цену значило бы
    // оценить вчерашний пул сегодняшним рынком
    const patched = historicalGmxApiData(
      apiData(),
      new Map([["ethereum", price(4000)]]),
    );

    expect(patched.prices.has(WETH)).toBe(true);
    expect(patched.prices.has(USDC)).toBe(false);
    expect(patched.prices.has(EXOTIC)).toBe(false);
  });

  it("справочник рынков и decimals оставляет как есть", () => {
    const live = apiData();
    const patched = historicalGmxApiData(live, new Map());

    expect(patched.decimals).toBe(live.decimals);
    expect(patched.markets).toBe(live.markets);
    expect(patched.prices.size).toBe(0);
  });
});
