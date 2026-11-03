import { describe, expect, it } from "vitest";
import type { PositionDto } from "@/lib/api/types";
import { gmPlaces } from "./gm-asset";

/**
 * Где лежит GM позиции, кроме кошелька на Arbitrum. Числа — из живого
 * кошелька: 26 650,759283 GM ETH-ETH на Ethereum и 0,00000011 GM остатка
 * внутри GMX, позиция на $21 015.
 */
function gm(
  quantity: string,
  valueUsd: number | null,
  details: NonNullable<PositionDto["gm"]>,
): PositionDto {
  return {
    id: "g",
    protocol: "gmx_v2",
    protocolLabel: "GMX v2",
    chain: "arbitrum",
    zone: "yield",
    zoneKey: "gmx_v2:arbitrum:g",
    ownPrincipalUsd: null,
    borrowedPrincipalUsd: null,
    withdrawnUsd: null,
    entryPriceUsd: null,
    entryPriceSetAt: null,
    ownCurrentUsd: 0,
    profitUsd: null,
    profitPct: null,
    title: "GM ETH/USD",
    subtitle: "ETH/USD [ETH-ETH]",
    quantity,
    valueUsd,
    components: [],
    feesUsd: null,
    fees24hUsd: null,
    fees24hReason: null,
    inRange: null,
    outOfRangeSince: null,
    range: null,
    supplyRatePercent: null,
    rewardsRatePercent: null,
    pendle: null,
    gm: details,
    walletId: "w",
    walletLabel: null,
    updatedAt: "2026-11-03T00:00:00.000Z",
  };
}

describe("gmPlaces", () => {
  it("позиция целиком на Ethereum, остаток в GMX дешевле доллара не показан", () => {
    const places = gmPlaces(
      gm("26650.759283113246", 21_014.95, {
        multichainQuantity: 0.000000113245976818,
        bridged: [{ chain: "ethereum", quantity: 26650.759283 }],
      }),
    );
    expect(places).toEqual([
      { label: "на Ethereum", quantity: 26650.759283, whole: true },
    ]);
  });

  it("часть на другой сети — с количеством, не «целиком»", () => {
    const places = gmPlaces(
      gm("100", 80, {
        multichainQuantity: 0,
        bridged: [{ chain: "ethereum", quantity: 40 }],
      }),
    );
    expect(places).toEqual([{ label: "на Ethereum", quantity: 40, whole: false }]);
  });

  it("обычная позиция в кошельке мест вне его не имеет", () => {
    expect(gmPlaces(gm("100", 80, { multichainQuantity: 0, bridged: [] }))).toEqual([]);
  });

  it("стоимость неизвестна — части показываются: неизвестно ≠ мало", () => {
    const places = gmPlaces(
      gm("100", null, { multichainQuantity: 0.0001, bridged: [] }),
    );
    expect(places.map((p) => p.label)).toEqual(["в балансе GMX"]);
  });
});
