import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { PendleMarket } from "@/lib/prices/pendle-api";
import {
  PENDLE_ORACLE,
  pendleRateToAsset,
  pendleRowOf,
  readChainPendle,
  type PendleRpcClient,
} from "./pendle";

/**
 * Читатель Pendle тестируется на инъецированном multicall: мок отвечает
 * по (адрес, функция), как ответила бы цепочка. Курсы взяты из живых
 * вызовов, зафиксированных в шапке pendle.ts.
 */

const WALLET = "0x00000000000000000000000000000000000000aa" as Address;

const MARKET: PendleMarket = {
  address: "0x4b912476356c914b154524c59b5a438a88e99429",
  name: "mixUSDC",
  expiry: "2026-10-29T00:00:00.000Z",
  pt: "0x45c00ec1a2797b507d3e955b208fb275795da669",
  yt: "0x0e012d6a77a7f6c91de7cb74c2732553876d1d61",
  sy: "0x9b44efca3e2a707b63dc00ce79d646e5e5d24ba5",
  impliedApyPercent: 5,
  underlyingApyPercent: 4,
};
const OTHER: PendleMarket = {
  ...MARKET,
  address: "0x1111111111111111111111111111111111111111",
  pt: "0x2222222222222222222222222222222222222222",
  yt: "0x3333333333333333333333333333333333333333",
  sy: "0x4444444444444444444444444444444444444444",
};
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

type Call = { address: string; functionName: string };
type Answer = (call: Call) => { status: "success"; result: unknown } | { status: "failure"; error: Error };

function client(answer: Answer): PendleRpcClient & { calls: Call[][] } {
  const calls: Call[][] = [];
  return {
    calls,
    multicall: vi.fn(async ({ contracts }) => {
      const batch = contracts.map((c: { address: string; functionName: string }) => ({
        address: c.address.toLowerCase(),
        functionName: c.functionName,
      }));
      calls.push(batch);
      return batch.map(answer);
    }),
  };
}

const ok = (result: unknown) => ({ status: "success" as const, result });
const fail = () => ({ status: "failure" as const, error: new Error("revert") });

/** Кошелек держит 1000 PT (6 знаков) и 0,5 LP (18 знаков) рынка mixUSDC. */
const holder: Answer = ({ address, functionName }) => {
  if (functionName === "balanceOf") {
    if (address === MARKET.pt) return ok(1_000_000_000n);
    if (address === MARKET.address) return ok(500_000_000_000_000_000n);
    return ok(0n);
  }
  if (functionName === "getPtToAssetRate") return ok(998_740_610_946_408_529n);
  if (functionName === "getLpToAssetRate") return ok(2_095_669_574_338n);
  if (functionName === "decimals") return ok(address === MARKET.pt ? 6 : 18);
  if (functionName === "assetInfo") return ok([0, USDC, 6]);
  if (functionName === "symbol") return ok("USDC");
  return fail();
};

const noLog = vi.fn(async () => {});

describe("курс оракула", () => {
  it("decimals токена и актива оба входят в курс", () => {
    // PT 6 знаков → USDC 6 знаков: курс как есть
    expect(pendleRateToAsset(998_740_610_946_408_529n, 6, 6)).toBeCloseTo(0.99874, 5);
    // LP 18 знаков → USDC 6: «сырое к сырому», поправка 10^12. Без нее
    // LP стоил бы в триллион раз меньше
    expect(pendleRateToAsset(2_095_669_574_338n, 18, 6)).toBeCloseTo(2.0957e6, -2);
  });

  it("погашенный PT — ровно 1, YT — ровно 0", () => {
    expect(pendleRateToAsset(10n ** 18n, 6, 6)).toBe(1);
    expect(pendleRateToAsset(0n, 6, 6)).toBe(0);
  });

  it("без курса или актива — null, «примерно 1» не подставляется", () => {
    expect(pendleRateToAsset(null, 18, 18)).toBeNull();
    expect(pendleRateToAsset(10n ** 18n, 18, null)).toBeNull();
  });
});

describe("чтение сети", () => {
  it("нулевые балансы отброшены, ненулевые прочитаны с курсом и активом", async () => {
    const c = client(holder);
    const status = await readChainPendle(c, "ethereum", WALLET, [MARKET, OTHER], noLog);
    expect(status.ok).toBe(true);
    expect(status.positions.map((p) => p.tokenType).sort()).toEqual(["lp", "pt"]);

    const pt = status.positions.find((p) => p.tokenType === "pt")!;
    expect(pt).toMatchObject({
      token: MARKET.pt,
      market: MARKET.address,
      decimals: 6,
      assetSymbol: "USDC",
      assetDecimals: 6,
      assetCoingeckoId: "usd-coin",
      expiry: MARKET.expiry,
    });

    // Первый проход — balanceOf по трем токенам двух рынков; курс просится
    // только по удержанным и только у оракула
    expect(c.calls[0]).toHaveLength(6);
    const rateCalls = c.calls[1].filter((x) => x.functionName.endsWith("ToAssetRate"));
    expect(rateCalls).toHaveLength(2);
    for (const call of rateCalls) expect(call.address).toBe(PENDLE_ORACLE.toLowerCase());
  });

  it("строка позиции: external_id — адрес токена, курс в человеческих единицах", async () => {
    const status = await readChainPendle(client(holder), "ethereum", WALLET, [MARKET], noLog);
    const pt = status.positions.find((p) => p.tokenType === "pt")!;
    const row = pendleRowOf("w1", pt, "2026-10-19T00:00:00.000Z");
    expect(row.external_id).toBe(MARKET.pt);
    expect(row.quantity).toBe("1000");
    expect(row.value_usd).toBeNull();
    expect(row.payload.rateToAsset).toBeCloseTo(0.99874, 5);
  });

  it("ревертнувший оракул — позиция есть, курса нет", async () => {
    const c = client((call) =>
      call.functionName === "getPtToAssetRate" ? fail() : holder(call),
    );
    const status = await readChainPendle(c, "ethereum", WALLET, [MARKET], noLog);
    expect(status.ok).toBe(true);
    const pt = status.positions.find((p) => p.tokenType === "pt")!;
    expect(pt.rateRaw).toBeNull();
    expect(pendleRowOf("w1", pt, "").payload.rateToAsset).toBeNull();
  });

  it("SY не ответил — актив неизвестен, цены нет, позиция остается", async () => {
    const c = client((call) => (call.functionName === "assetInfo" ? fail() : holder(call)));
    const status = await readChainPendle(c, "ethereum", WALLET, [MARKET], noLog);
    expect(status.ok).toBe(true);
    expect(status.positions[0].assetSymbol).toBeNull();
    expect(status.positions[0].assetCoingeckoId).toBeNull();
  });

  it("нативный актив SY (нулевой адрес) — это ETH, symbol() не вызывается", async () => {
    const c = client((call) =>
      call.functionName === "assetInfo"
        ? ok([0, "0x0000000000000000000000000000000000000000", 18])
        : holder(call),
    );
    const status = await readChainPendle(c, "ethereum", WALLET, [MARKET], noLog);
    expect(status.positions[0].assetSymbol).toBe("ETH");
    expect(c.calls).toHaveLength(2);
  });

  it("не прочитан decimals — сеть непрочитана, чтобы кэш не удалил позицию", async () => {
    const c = client((call) => (call.functionName === "decimals" ? fail() : holder(call)));
    const status = await readChainPendle(c, "ethereum", WALLET, [MARKET], noLog);
    expect(status.ok).toBe(false);
    expect(status.positions).toEqual([]);
  });

  it("упавший RPC — «неизвестно», а не «позиций нет»", async () => {
    const c: PendleRpcClient = {
      multicall: vi.fn(async () => {
        throw new Error("timeout");
      }),
    };
    const status = await readChainPendle(c, "arbitrum", WALLET, [MARKET], noLog);
    expect(status).toMatchObject({ chain: "arbitrum", ok: false, error: "timeout" });
  });

  it("без рынков сеть не опрашивается", async () => {
    const c = client(holder);
    const status = await readChainPendle(c, "optimism", WALLET, [], noLog);
    expect(status).toEqual({ chain: "optimism", ok: true, positions: [] });
    expect(c.calls).toHaveLength(0);
  });
});
