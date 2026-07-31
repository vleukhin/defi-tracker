import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import {
  FLUID_CHAINS,
  FLUID_LENDING_RESOLVER,
  readChainFluid,
  underlyingSymbol,
  type FluidRpcClient,
} from "./fluid";

/**
 * Читатель депозитов Fluid.
 *
 * Главное свойство, ради которого тест и написан: упавшее чтение — это
 * «неизвестно», а не «депозитов нет». Второе трактовалось бы как вывод всех
 * средств и стерло бы позиции из кэша.
 */

const WALLET = "0x1111111111111111111111111111111111111111" as Address;

function entry(
  symbol: string,
  underlyingAssets: bigint,
  decimals = 6,
  tokenAddress = "0x00000000000000000000000000000000000000f1",
) {
  return {
    fTokenDetails: {
      tokenAddress: tokenAddress as Address,
      isNativeUnderlying: false,
      symbol,
      decimals: BigInt(decimals),
      asset: "0x00000000000000000000000000000000000000aa" as Address,
    },
    userPosition: { underlyingAssets },
  };
}

function clientReturning(value: unknown): FluidRpcClient {
  return { readContract: vi.fn().mockResolvedValue(value) };
}

const noLog = vi.fn();

describe("readChainFluid", () => {
  it("читает депозит одним вызовом резолвера", async () => {
    const client = clientReturning([entry("fUSDC", 1_000_000_000n)]);
    const status = await readChainFluid(client, "arbitrum", WALLET, noLog);

    expect(status.ok).toBe(true);
    expect(status.positions).toHaveLength(1);
    expect(status.positions[0].symbol).toBe("USDC");
    expect(status.positions[0].coingeckoId).toBe("usd-coin");
    expect(status.positions[0].raw).toBe(1_000_000_000n);
    expect(client.readContract).toHaveBeenCalledTimes(1);
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: FLUID_LENDING_RESOLVER }),
    );
  });

  it("нулевые депозиты отбрасываются — резолвер отдает все fToken'ы сети", async () => {
    const client = clientReturning([
      entry("fUSDC", 0n),
      entry("fUSDT", 5_000_000n),
      entry("fWETH", 0n, 18),
    ]);
    const status = await readChainFluid(client, "arbitrum", WALLET, noLog);
    expect(status.positions.map((p) => p.symbol)).toEqual(["USDT"]);
  });

  it("отказ сети = «неизвестно», а не «депозитов нет»", async () => {
    const client: FluidRpcClient = {
      readContract: vi.fn().mockRejectedValue(new Error("RPC down")),
    };
    const status = await readChainFluid(client, "base", WALLET, noLog);

    expect(status.ok).toBe(false);
    expect(status.error).toContain("RPC down");
    expect(status.positions).toEqual([]);
  });

  it("неожиданная форма ответа тоже «неизвестно», а не пусто", async () => {
    const status = await readChainFluid(
      clientReturning("что-то не то"),
      "ethereum",
      WALLET,
      noLog,
    );
    expect(status.ok).toBe(false);
    expect(status.error).toBe("unexpected result type");
  });

  it("decimals берутся из ответа, а не предполагаются равными 18", async () => {
    // USDC — 6 знаков; предположение о 18 занизило бы депозит в 10^12 раз
    const client = clientReturning([entry("fUSDC", 250_000_000n, 6)]);
    const status = await readChainFluid(client, "arbitrum", WALLET, noLog);
    expect(status.positions[0].decimals).toBe(6);
  });

  it("неизвестный тикер оставляет позицию без coingecko id, но не теряет ее", async () => {
    const client = clientReturning([entry("fКАКОЙТО", 1n)]);
    const status = await readChainFluid(client, "arbitrum", WALLET, noLog);
    expect(status.positions).toHaveLength(1);
    expect(status.positions[0].coingeckoId).toBeNull();
  });
});

describe("underlyingSymbol", () => {
  it("снимает префикс f", () => {
    expect(underlyingSymbol("fUSDC")).toBe("USDC");
    expect(underlyingSymbol("fwstETH")).toBe("wstETH");
  });

  it("символ без префикса не портит", () => {
    expect(underlyingSymbol("USDC")).toBe("USDC");
  });
});

describe("список сетей", () => {
  it("Optimism отсутствует: Fluid там не развернут", () => {
    expect([...FLUID_CHAINS]).toEqual(["ethereum", "arbitrum", "base"]);
  });
});
