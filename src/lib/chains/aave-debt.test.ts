import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import {
  AAVE_DEBT_RESERVES,
  AAVE_POOLS,
  MAX_UINT256,
  borrowRatePercent,
  mapAccountData,
  readChainAaveDebt,
  type AaveDebtRpcClient,
} from "./aave-debt";
import { CHAIN_IDS } from "./config";

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as Address;
const noopLog = vi.fn(async () => {});

/**
 * Кортеж getUserAccountData: [totalCollateralBase, totalDebtBase,
 * availableBorrowsBase, liqThreshold, ltv, healthFactor].
 */
function accountTuple(o: {
  collateralBase?: bigint;
  debtBase?: bigint;
  hf?: bigint;
}): readonly bigint[] {
  return [
    o.collateralBase ?? 0n,
    o.debtBase ?? 0n,
    0n,
    0n,
    0n,
    o.hf ?? MAX_UINT256,
  ];
}

describe("mapAccountData", () => {
  it("base-величины 8-decimal переводятся в USD", () => {
    // 12 345.678 $ залога, 1 000.5 $ долга
    const acc = mapAccountData(
      accountTuple({
        collateralBase: 1_234_567_800_000n,
        debtBase: 100_050_000_000n,
        hf: 2_500_000_000_000_000_000n, // 2.5e18
      }),
    );
    expect(acc.totalCollateralUsd).toBeCloseTo(12_345.678, 6);
    expect(acc.totalDebtUsd).toBeCloseTo(1_000.5, 6);
    expect(acc.healthFactor).toBeCloseTo(2.5, 9);
  });

  it("HF масштабируется из 1e18", () => {
    const acc = mapAccountData(
      accountTuple({ debtBase: 1n, hf: 1_050_000_000_000_000_000n }),
    );
    expect(acc.healthFactor).toBeCloseTo(1.05, 9);
  });

  it("uint256.max (нет долга) -> healthFactor null, не гигантское число", () => {
    const acc = mapAccountData(
      accountTuple({ collateralBase: 100_000_000n, debtBase: 0n, hf: MAX_UINT256 }),
    );
    expect(acc.healthFactor).toBeNull();
    expect(acc.totalDebtUsd).toBe(0);
  });

  it("нулевой долг -> null даже при числовом HF в кортеже", () => {
    const acc = mapAccountData(
      accountTuple({ debtBase: 0n, hf: 3_000_000_000_000_000_000n }),
    );
    expect(acc.healthFactor).toBeNull();
  });
});

describe("AAVE_DEBT_RESERVES", () => {
  it("покрывает ВСЕ резервы address book (долг бывает и в стейблах)", () => {
    for (const chain of CHAIN_IDS) {
      const reserves = AAVE_DEBT_RESERVES[chain];
      expect(reserves.length).toBeGreaterThan(0);
      // стейблы присутствуют — курируемый список залога их не покрывал
      expect(reserves.some((r) => r.symbol.startsWith("USDC"))).toBe(true);
      for (const r of reserves) {
        expect(r.vToken).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(r.decimals).toBeGreaterThan(0);
      }
    }
    // USDC везде оценивается: мажорный стейбл обязан иметь coingecko id
    const usdc = AAVE_DEBT_RESERVES.ethereum.find((r) => r.symbol === "USDC")!;
    expect(usdc.coingeckoId).toBe("usd-coin");
    expect(AAVE_POOLS.ethereum).toMatch(/^0x/);
  });
});

/** Мок RPC: первый контракт — getUserAccountData, остальные — balanceOf. */
function mockClient(opts: {
  account?: readonly bigint[] | "fail";
  balance?: bigint;
  balances?: Map<number, bigint>;
  failIndexes?: number[];
  throwAll?: boolean;
}): AaveDebtRpcClient {
  return {
    async multicall({ contracts }) {
      if (opts.throwAll) throw new Error("RPC down");
      return contracts.map((c, i) => {
        if (c.functionName === "getUserAccountData") {
          return opts.account === "fail"
            ? { status: "failure" as const, error: new Error("pool reverted") }
            : {
                status: "success" as const,
                result: opts.account ?? accountTuple({}),
              };
        }
        const debtIndex = i - 1;
        if (opts.failIndexes?.includes(debtIndex)) {
          return {
            status: "failure" as const,
            error: new Error("execution reverted"),
          };
        }
        return {
          status: "success" as const,
          result: opts.balances?.get(debtIndex) ?? opts.balance ?? 0n,
        };
      });
    },
  };
}

describe("readChainAaveDebt", () => {
  it("канонические totals+HF из getUserAccountData, разбивка из v-токенов", async () => {
    const client = mockClient({
      account: accountTuple({
        collateralBase: 5_000_000_000_000n, // $50k
        debtBase: 1_000_000_000_000n, // $10k
        hf: 1_800_000_000_000_000_000n, // 1.8
      }),
      balances: new Map([[0, 123_456n]]),
    });
    const res = await readChainAaveDebt(client, "arbitrum", WALLET, noopLog);

    expect(res.ok).toBe(true);
    expect(res.account).not.toBeNull();
    expect(res.account!.totalCollateralUsd).toBeCloseTo(50_000, 6);
    expect(res.account!.totalDebtUsd).toBeCloseTo(10_000, 6);
    expect(res.account!.healthFactor).toBeCloseTo(1.8, 9);
    // разбивка: один ненулевой долг + остальные нулевые (нули НЕ выброшены
    // на чтении — их выкидывает/чистит persist)
    expect(res.debts).toHaveLength(AAVE_DEBT_RESERVES.arbitrum.length);
    expect(res.debts[0].raw).toBe(123_456n);
    expect(res.failedReserves).toEqual([]);
  });

  it("упавший balanceOf = «неизвестно», не ноль", async () => {
    const client = mockClient({ balance: 10n, failIndexes: [0, 2] });
    const res = await readChainAaveDebt(client, "optimism", WALLET, noopLog);

    expect(res.ok).toBe(true);
    expect(res.failedReserves).toHaveLength(2);
    expect(res.failedReserves[0].reason).toContain("reverted");
    const failed = new Set(res.failedReserves.map((f) => f.vToken));
    for (const d of res.debts) expect(failed.has(d.vToken)).toBe(false);
    expect(res.debts).toHaveLength(AAVE_DEBT_RESERVES.optimism.length - 2);
  });

  it("упавший getUserAccountData -> account null (health не перезаписывать), разбивка живет", async () => {
    const client = mockClient({ account: "fail", balance: 5n });
    const res = await readChainAaveDebt(client, "base", WALLET, noopLog);

    expect(res.ok).toBe(true);
    expect(res.account).toBeNull();
    expect(res.accountError).toContain("reverted");
    expect(res.debts).toHaveLength(AAVE_DEBT_RESERVES.base.length);
  });

  it("полный отказ RPC -> ok: false с причиной, без исключения", async () => {
    const res = await readChainAaveDebt(
      mockClient({ throwAll: true }),
      "ethereum",
      WALLET,
      noopLog,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain("RPC down");
    expect(res.account).toBeNull();
    expect(res.debts).toEqual([]);
  });
});

/**
 * Ставка займа — порог, ниже которого депозит на стороннем лендинге держать
 * незачем (docs/07 §3). Читается тем же multicall, что и долг.
 */
describe("ставка variable-займа", () => {
  it("ray (1e27) -> проценты годовых", () => {
    // 6,25% APR
    expect(
      borrowRatePercent({ currentVariableBorrowRate: 62_500_000_000_000_000_000_000_000n }),
    ).toBeCloseTo(6.25, 9);
  });

  it("форма ответа не та -> null, а не выдуманное число", () => {
    expect(borrowRatePercent(0n)).toBeNull();
    expect(borrowRatePercent(null)).toBeNull();
    expect(borrowRatePercent({ liquidityIndex: 1n })).toBeNull();
    // Неправдоподобная величина: декодировали не то поле
    expect(
      borrowRatePercent({ currentVariableBorrowRate: 10n ** 30n }),
    ).toBeNull();
  });

  it("ставка попадает в стейбл-резервы и не попадает в остальные", async () => {
    const rate = 50_000_000_000_000_000_000_000_000n; // 5%
    const client: AaveDebtRpcClient = {
      async multicall({ contracts }) {
        return contracts.map((c) => {
          if (c.functionName === "getUserAccountData") {
            return { status: "success" as const, result: accountTuple({}) };
          }
          if (c.functionName === "getReserveData") {
            return {
              status: "success" as const,
              result: { currentVariableBorrowRate: rate },
            };
          }
          return { status: "success" as const, result: 1_000n };
        });
      },
    };
    const res = await readChainAaveDebt(client, "arbitrum", WALLET, noopLog);

    const usdc = res.debts.find((d) => d.symbol === "USDCn" || d.symbol === "USDC");
    expect(usdc?.borrowRatePercent).toBeCloseTo(5, 9);
    const weth = res.debts.find((d) => d.symbol === "WETH");
    // По не-стейблам ставку не читаем: сравнивать ее не с чем
    expect(weth?.borrowRatePercent).toBeNull();
  });

  it("упавший getReserveData -> ставка null, разбивка долга живет", async () => {
    const client: AaveDebtRpcClient = {
      async multicall({ contracts }) {
        return contracts.map((c) => {
          if (c.functionName === "getUserAccountData") {
            return { status: "success" as const, result: accountTuple({}) };
          }
          if (c.functionName === "getReserveData") {
            return {
              status: "failure" as const,
              error: new Error("execution reverted"),
            };
          }
          return { status: "success" as const, result: 7n };
        });
      },
    };
    const res = await readChainAaveDebt(client, "base", WALLET, noopLog);

    expect(res.debts).toHaveLength(AAVE_DEBT_RESERVES.base.length);
    expect(res.debts.every((d) => d.borrowRatePercent === null)).toBe(true);
    expect(res.debts[0].raw).toBe(7n);
  });
});
