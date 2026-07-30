import { describe, expect, it } from "vitest";
import { BUILTIN_BUCKET_IDS, TOKEN_ALLOWLIST } from "./allowlist";
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

  it("дефолтные корзины: WBTC/tBTC->BTC, WETH/wstETH/rETH->ETH, стейблы->Stablecoins", () => {
    for (const chain of CHAIN_IDS) {
      for (const t of TOKEN_ALLOWLIST[chain]) {
        const tag = `${chain}:${t.symbol}`;
        if (["WBTC", "tBTC", "cbBTC", "LBTC"].includes(t.symbol)) {
          expect(t.defaultBucket, tag).toBe("BTC");
        }
        if (["WETH", "wstETH", "stETH", "rETH", "cbETH", "weETH"].includes(t.symbol)) {
          expect(t.defaultBucket, tag).toBe("ETH");
        }
        if (["USDC", "USDC.e", "USDbC", "USDT", "DAI", "USDe", "sUSDe"].includes(t.symbol)) {
          expect(t.defaultBucket, tag).toBe("STABLE");
        }
        // Некорзинные (ARB, OP, LINK...) — null -> «Прочее»
        if (["ARB", "OP", "LINK", "UNI", "GMX", "AERO"].includes(t.symbol)) {
          expect(t.defaultBucket, tag).toBeNull();
        }
      }
    }
  });

  it("встроенные корзины имеют фиксированные UUID из миграции", () => {
    expect(BUILTIN_BUCKET_IDS.BTC).toBe("00000000-0000-0000-0000-000000000001");
    expect(BUILTIN_BUCKET_IDS.ETH).toBe("00000000-0000-0000-0000-000000000002");
    expect(BUILTIN_BUCKET_IDS.STABLE).toBe("00000000-0000-0000-0000-000000000003");
    expect(BUILTIN_BUCKET_IDS.OTHER).toBe("00000000-0000-0000-0000-000000000004");
  });
});
