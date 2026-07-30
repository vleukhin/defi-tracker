import { describe, expect, it } from "vitest";
import { TOKEN_ALLOWLIST } from "./allowlist";
import { CHAIN_IDS } from "./config";

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
