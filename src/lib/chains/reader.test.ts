import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { TOKEN_ALLOWLIST } from "./allowlist";
import { CHAIN_IDS, type ChainId } from "./config";
import {
  readChainBalances,
  readWalletBalances,
  type BalanceRpcClient,
} from "./reader";

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as Address;
const noopLog = vi.fn(async () => {});

/** Мок RPC-клиента: все balanceOf succeeд по значению, кроме failIndexes. */
function mockClient(opts: {
  native?: bigint;
  balance?: bigint;
  failIndexes?: number[];
  throwAll?: boolean;
}): BalanceRpcClient {
  return {
    async getBalance() {
      if (opts.throwAll) throw new Error("RPC down");
      return opts.native ?? 0n;
    },
    async multicall({ contracts }) {
      if (opts.throwAll) throw new Error("RPC down");
      return contracts.map((_, i) =>
        opts.failIndexes?.includes(i)
          ? { status: "failure" as const, error: new Error("execution reverted") }
          : { status: "success" as const, result: opts.balance ?? 0n },
      );
    },
  };
}

describe("readChainBalances", () => {
  it("возвращает нативный баланс + balanceOf всего allowlist как bigint", async () => {
    const client = mockClient({ native: 123n, balance: 456n });
    const res = await readChainBalances(client, "ethereum", WALLET, noopLog);

    expect(res.ok).toBe(true);
    expect(res.balances).toHaveLength(TOKEN_ALLOWLIST.ethereum.length + 1);

    const native = res.balances[0];
    expect(native.contractAddress).toBeNull();
    expect(native.symbol).toBe("ETH");
    expect(native.decimals).toBe(18);
    expect(native.raw).toBe(123n);

    // decimals берутся из allowlist (из контракта), не предполагаются 18
    const usdc = res.balances.find((b) => b.symbol === "USDC")!;
    expect(usdc.decimals).toBe(6);
    const wbtc = res.balances.find((b) => b.symbol === "WBTC")!;
    expect(wbtc.decimals).toBe(8);
  });

  it("упавший вызов внутри multicall = «неизвестно», не ноль (allowFailure)", async () => {
    const client = mockClient({ balance: 10n, failIndexes: [0, 2] });
    const res = await readChainBalances(client, "arbitrum", WALLET, noopLog);

    expect(res.ok).toBe(true);
    expect(res.failedTokens).toHaveLength(2);
    expect(res.failedTokens[0].contractAddress).toBe(TOKEN_ALLOWLIST.arbitrum[0].address);
    expect(res.failedTokens[0].reason).toContain("reverted");
    // Упавшие НЕ попали в balances даже нулем
    const failedAddrs = new Set(res.failedTokens.map((f) => f.contractAddress));
    for (const b of res.balances) {
      if (b.contractAddress) expect(failedAddrs.has(b.contractAddress)).toBe(false);
    }
    // native + (allowlist - 2 упавших)
    expect(res.balances).toHaveLength(TOKEN_ALLOWLIST.arbitrum.length - 2 + 1);
  });

  it("полный отказ RPC -> ok: false с причиной, без исключения", async () => {
    const res = await readChainBalances(mockClient({ throwAll: true }), "base", WALLET, noopLog);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("RPC down");
    expect(res.balances).toEqual([]);
  });
});

describe("readWalletBalances: изоляция отказа сети (S1.3)", () => {
  it("отказ одной сети не мешает остальным трем", async () => {
    const clients = Object.fromEntries(
      CHAIN_IDS.map((chain) => [
        chain,
        mockClient(chain === "optimism" ? { throwAll: true } : { native: 1n, balance: 2n }),
      ]),
    ) as Record<ChainId, BalanceRpcClient>;

    const results = await readWalletBalances(WALLET, { clients, logCall: noopLog });

    expect(results).toHaveLength(4);
    const byChain = new Map(results.map((r) => [r.chain, r]));
    expect(byChain.get("optimism")!.ok).toBe(false);
    for (const chain of ["ethereum", "arbitrum", "base"] as const) {
      expect(byChain.get(chain)!.ok).toBe(true);
      expect(byChain.get(chain)!.balances.length).toBeGreaterThan(0);
    }
  });
});
