import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import {
  AAVE_SUPPLY_RESERVES,
  readChainAaveSupply,
  usesAsCollateral,
  type AaveSupplyRpcClient,
} from "./aave-supply";
import { supplyRatePercent } from "./aave-debt";
import { CHAIN_IDS } from "./config";
import { isStableSymbol } from "@/lib/stables";

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as Address;
const noopLog = vi.fn(async () => {});

type CallResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error; result?: undefined };

const ok = (result: unknown): CallResult => ({ status: "success", result });
const fail = (msg: string): CallResult => ({
  status: "failure",
  error: new Error(msg),
});

/** 5% годовых в ray (1e25 = 1%). */
const RATE_5PCT = 5n * 10n ** 25n;

/** Клиент, отдающий ответ multicall по порядку contracts. */
function clientFor(
  build: (count: number) => CallResult[],
): AaveSupplyRpcClient {
  return {
    multicall: vi.fn(async ({ contracts }) => build(contracts.length)),
  };
}

describe("AAVE_SUPPLY_RESERVES", () => {
  it("только стейблы, и на каждой сети они есть", () => {
    for (const chain of CHAIN_IDS) {
      const reserves = AAVE_SUPPLY_RESERVES[chain];
      expect(reserves.length).toBeGreaterThan(0);
      expect(reserves.every((r) => isStableSymbol(r.symbol))).toBe(true);
    }
  });

  it("BTC/ETH-резервы сюда не попадают — это залог, а не депозит", () => {
    const symbols = AAVE_SUPPLY_RESERVES.ethereum.map((r) => r.symbol);
    expect(symbols).toContain("USDC");
    expect(symbols).not.toContain("WETH");
    expect(symbols).not.toContain("WBTC");
  });

  it("нативный USDC Arbitrum (USDCn) оценивается, а не теряет цену", () => {
    const usdcn = AAVE_SUPPLY_RESERVES.arbitrum.find((r) => r.symbol === "USDCn");
    expect(usdcn?.coingeckoId).toBe("usd-coin");
  });
});

describe("usesAsCollateral", () => {
  it("старший бит пары резерва — «использует как залог»", () => {
    // резерв 3: биты 6 (заём) и 7 (залог)
    expect(usesAsCollateral(1n << 7n, 3)).toBe(true);
    expect(usesAsCollateral(1n << 6n, 3)).toBe(false);
    expect(usesAsCollateral(0n, 0)).toBe(false);
    expect(usesAsCollateral(0b10n, 0)).toBe(true);
  });

  it("неизвестная карта или индекс — null, не false", () => {
    expect(usesAsCollateral(null, 3)).toBeNull();
    expect(usesAsCollateral(1n << 7n, null)).toBeNull();
  });
});

describe("supplyRatePercent", () => {
  it("currentLiquidityRate в ray → % годовых", () => {
    expect(supplyRatePercent({ currentLiquidityRate: RATE_5PCT })).toBeCloseTo(5, 9);
  });

  it("чужая форма — null", () => {
    expect(supplyRatePercent(null)).toBeNull();
    expect(supplyRatePercent({ currentVariableBorrowRate: RATE_5PCT })).toBeNull();
  });
});

describe("readChainAaveSupply", () => {
  const reserves = AAVE_SUPPLY_RESERVES.arbitrum;
  const n = reserves.length;
  const usdcIdx = reserves.findIndex((r) => r.symbol === "USDCn");
  const usdtIdx = reserves.findIndex((r) => r.symbol === "USDT");

  /** [config, ...balanceOf, ...getReserveData] */
  function answer(o: {
    config?: CallResult;
    balances?: Record<number, CallResult>;
    reserve?: (i: number) => CallResult;
  }): CallResult[] {
    return [
      o.config ?? ok({ data: 1n << 7n }), // резерв 3 — в залоге
      ...reserves.map((_, i) => o.balances?.[i] ?? ok(0n)),
      ...reserves.map(
        (_, i) =>
          o.reserve?.(i) ?? ok({ currentLiquidityRate: RATE_5PCT, id: i === usdcIdx ? 3 : 10 + i }),
      ),
    ];
  }

  it("ненулевой депозит — позиция со ставкой и признаком залога", async () => {
    const client = clientFor(() =>
      answer({ balances: { [usdcIdx]: ok(12_400_000_000n) } }),
    );
    const status = await readChainAaveSupply(client, "arbitrum", WALLET, noopLog);

    expect(status.ok).toBe(true);
    expect(status.positions).toHaveLength(1);
    const p = status.positions[0];
    expect(p.symbol).toBe("USDCn");
    expect(p.raw).toBe(12_400_000_000n);
    expect(p.supplyRatePercent).toBeCloseTo(5, 9);
    expect(p.usedAsCollateral).toBe(true);
    // один multicall: конфигурация + баланс и резерв на каждый стейбл
    const call = (client.multicall as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.contracts).toHaveLength(1 + 2 * n);
  });

  it("депозит не в залоге — false, а не null", async () => {
    const client = clientFor(() =>
      answer({ balances: { [usdtIdx]: ok(1_000_000n) } }),
    );
    const status = await readChainAaveSupply(client, "arbitrum", WALLET, noopLog);
    expect(status.positions[0].usedAsCollateral).toBe(false);
  });

  it("нулевые балансы — не позиции", async () => {
    const status = await readChainAaveSupply(
      clientFor(() => answer({})),
      "arbitrum",
      WALLET,
      noopLog,
    );
    expect(status.ok).toBe(true);
    expect(status.positions).toEqual([]);
    expect(status.failedReserves).toEqual([]);
  });

  it("упавший balanceOf — «неизвестно», не ноль", async () => {
    const status = await readChainAaveSupply(
      clientFor(() => answer({ balances: { [usdcIdx]: fail("revert") } })),
      "arbitrum",
      WALLET,
      noopLog,
    );
    expect(status.positions).toEqual([]);
    expect(status.failedReserves).toHaveLength(1);
    expect(status.failedReserves[0].symbol).toBe("USDCn");
  });

  it("упавшие конфигурация и резерв не отменяют депозит", async () => {
    const status = await readChainAaveSupply(
      clientFor(() =>
        answer({
          config: fail("revert"),
          balances: { [usdcIdx]: ok(5_000_000n) },
          reserve: () => fail("decode"),
        }),
      ),
      "arbitrum",
      WALLET,
      noopLog,
    );
    expect(status.positions).toHaveLength(1);
    expect(status.positions[0].supplyRatePercent).toBeNull();
    expect(status.positions[0].usedAsCollateral).toBeNull();
  });

  it("сеть не ответила — ok: false, без позиций", async () => {
    const client: AaveSupplyRpcClient = {
      multicall: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    };
    const status = await readChainAaveSupply(client, "arbitrum", WALLET, noopLog);
    expect(status.ok).toBe(false);
    expect(status.error).toBe("rpc down");
    expect(status.positions).toEqual([]);
  });
});
