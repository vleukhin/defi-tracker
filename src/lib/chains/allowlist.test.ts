import { describe, expect, it } from "vitest";
import {
  AaveV3Arbitrum,
  AaveV3Base,
  AaveV3Ethereum,
  AaveV3Optimism,
} from "@bgd-labs/aave-address-book";
import { TOKEN_ALLOWLIST } from "./allowlist";
import { CHAIN_IDS, type ChainId } from "./config";

describe("TOKEN_ALLOWLIST: инварианты справочника", () => {
  it("адреса lowercase, валидный hex, уникальны в пределах сети", () => {
    for (const chain of CHAIN_IDS) {
      const addrs = TOKEN_ALLOWLIST[chain].map((t) => t.address);
      for (const a of addrs) expect(a).toMatch(/^0x[0-9a-f]{40}$/);
      expect(new Set(addrs).size).toBe(addrs.length);
    }
  });

  it("decimals не «предполагаются 18»: USDC/USDT=6, WBTC/cbBTC=8", () => {
    for (const chain of CHAIN_IDS) {
      for (const t of TOKEN_ALLOWLIST[chain]) {
        if (["USDC", "USDC.e", "USDbC", "USDT", "EURC"].includes(t.symbol)) {
          expect(t.decimals, `${chain}:${t.symbol}`).toBe(6);
        }
        if (["WBTC", "cbBTC", "LBTC"].includes(t.symbol)) {
          expect(t.decimals, `${chain}:${t.symbol}`).toBe(8);
        }
      }
    }
  });

  it("USDC и USDC.e — разные активы с разными coingecko id", () => {
    for (const chain of ["arbitrum", "optimism"] as const) {
      const usdc = TOKEN_ALLOWLIST[chain].find((t) => t.symbol === "USDC")!;
      const usdce = TOKEN_ALLOWLIST[chain].find((t) => t.symbol === "USDC.e")!;
      expect(usdc.address).not.toBe(usdce.address);
      expect(usdc.coingeckoId).not.toBe(usdce.coingeckoId);
    }
  });
});

/**
 * Сторож против двойного счета.
 *
 * Этим списком читаются СВОБОДНЫЕ средства кошелька — то, что не в залоге
 * и не в позициях. Залог живет в aToken'ах, долг в vToken'ах, депозит Fluid
 * в fToken'ах, GM-пулы перечисляются по списку рынков GMX. Стоит одному
 * такому адресу попасть в allowlist, и его стоимость посчитается дважды:
 * своим контуром и как свободные средства. Молча — цифры просто станут
 * больше.
 *
 * Тест зеленый на момент написания: он охраняет будущие пополнения списка.
 */
describe("TOKEN_ALLOWLIST: нет пересечений с залогом, долгом и позициями", () => {
  const MARKETS: Record<ChainId, { ASSETS: Record<string, unknown> }> = {
    ethereum: AaveV3Ethereum,
    arbitrum: AaveV3Arbitrum,
    base: AaveV3Base,
    optimism: AaveV3Optimism,
  };

  it("ни один адрес не совпадает с A_TOKEN или V_TOKEN Aave v3", () => {
    for (const chain of CHAIN_IDS) {
      const wrapped = new Set<string>();
      for (const asset of Object.values(MARKETS[chain].ASSETS)) {
        const spec = asset as { A_TOKEN?: string; V_TOKEN?: string };
        if (spec.A_TOKEN) wrapped.add(spec.A_TOKEN.toLowerCase());
        if (spec.V_TOKEN) wrapped.add(spec.V_TOKEN.toLowerCase());
      }
      for (const t of TOKEN_ALLOWLIST[chain]) {
        expect(
          wrapped.has(t.address),
          `${chain}:${t.symbol} — это aToken или vToken, залог и долг читаются своим контуром`,
        ).toBe(false);
      }
    }
  });

  it("нет символов, похожих на fToken Fluid или на GM-токен GMX", () => {
    for (const chain of CHAIN_IDS) {
      for (const t of TOKEN_ALLOWLIST[chain]) {
        // fUSDC, fWETH — обертки депозита Fluid; GM… — токены рынков GMX.
        // Голый GMX — governance-токен, к пулам отношения не имеет.
        expect(t.symbol, `${chain}:${t.symbol}`).not.toMatch(/^f[A-Z]/);
        expect(t.symbol, `${chain}:${t.symbol}`).not.toMatch(/^GM[^X]|^GM$/);
      }
    }
  });
});
