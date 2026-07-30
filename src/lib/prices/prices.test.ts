import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TokenBucket } from "./token-bucket";
import { getPrices, PRICE_TTL_MS, type AssetForPricing } from "./index";

const NOW = Date.parse("2026-07-30T12:00:00.000Z");
const FRESH_AT = new Date(NOW - 60_000).toISOString(); // 1 мин назад
const EXPIRED_AT = new Date(NOW - PRICE_TTL_MS - 60_000).toISOString(); // 6 мин назад

const fastBucket = () => new TokenBucket(1000, 1000, () => 0);
const noopLog = vi.fn(async () => {});

interface CacheRow {
  asset_id: string;
  price_usd: number;
  fetched_at: string;
}

/** Минимальный фейк service-role клиента: только то, что зовет getPrices. */
function fakeAdmin(cacheRows: CacheRow[]) {
  const upserted: CacheRow[] = [];
  const client = {
    from(table: string) {
      if (table !== "price_cache") throw new Error(`неожиданная таблица ${table}`);
      return {
        select: () => ({
          in: async () => ({ data: cacheRows, error: null }),
        }),
        upsert: async (rows: CacheRow[]) => {
          upserted.push(...rows);
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, upserted };
}

const erc20 = (id: string, chain: AssetForPricing["chain"], addr: string, cg: string | null): AssetForPricing => ({
  id,
  chain,
  contract_address: addr,
  kind: "erc20",
  coingecko_id: cg,
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("getPrices: кэш с TTL 5 минут (S1.4)", () => {
  it("свежий кэш отдается без похода в CoinGecko", async () => {
    const { client } = fakeAdmin([
      { asset_id: "a1", price_usd: 42, fetched_at: FRESH_AT },
    ]);
    const fetchFn = vi.fn();

    const prices = await getPrices([erc20("a1", "ethereum", "0x" + "1".repeat(40), "tkn")], {
      admin: client,
      fetchIfExpired: true,
      nowMs: NOW,
      cg: { fetchFn: fetchFn as unknown as typeof fetch, bucket: fastBucket(), logCall: noopLog },
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(prices.get("a1")).toEqual({
      assetId: "a1",
      priceUsd: 42,
      fetchedAt: FRESH_AT,
      stale: false,
    });
  });

  it("истекший кэш дотягивается из CoinGecko и апсертится", async () => {
    const addr = "0x" + "2".repeat(40);
    const { client, upserted } = fakeAdmin([
      { asset_id: "a1", price_usd: 40, fetched_at: EXPIRED_AT },
    ]);
    const fetchFn = vi.fn(async () => jsonResponse({ [addr]: { usd: 45 } }));

    const prices = await getPrices([erc20("a1", "arbitrum", addr, "tkn")], {
      admin: client,
      fetchIfExpired: true,
      nowMs: NOW,
      cg: { fetchFn: fetchFn as unknown as typeof fetch, bucket: fastBucket(), logCall: noopLog },
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL(fetchFn.mock.calls[0]![0] as unknown as string);
    expect(url.pathname).toContain("/simple/token_price/arbitrum-one");
    expect(prices.get("a1")!.priceUsd).toBe(45);
    expect(prices.get("a1")!.stale).toBe(false);
    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toMatchObject({ asset_id: "a1", price_usd: 45, source: "coingecko" });
  });

  it("отказ CoinGecko -> устаревшая цена с ее fetched_at и stale: true", async () => {
    const { client, upserted } = fakeAdmin([
      { asset_id: "a1", price_usd: 40, fetched_at: EXPIRED_AT },
    ]);
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });

    const prices = await getPrices([erc20("a1", "base", "0x" + "3".repeat(40), "tkn")], {
      admin: client,
      fetchIfExpired: true,
      nowMs: NOW,
      cg: { fetchFn: fetchFn as unknown as typeof fetch, bucket: fastBucket(), logCall: noopLog },
    });

    expect(prices.get("a1")).toEqual({
      assetId: "a1",
      priceUsd: 40,
      fetchedAt: EXPIRED_AT,
      stale: true,
    });
    expect(upserted).toHaveLength(0);
  });

  it("актив без coingecko_id никогда не запрашивается (анти-скам)", async () => {
    const { client } = fakeAdmin([]);
    const fetchFn = vi.fn();

    const prices = await getPrices(
      [erc20("scam", "ethereum", "0x" + "4".repeat(40), null)],
      {
        admin: client,
        fetchIfExpired: true,
        nowMs: NOW,
        cg: { fetchFn: fetchFn as unknown as typeof fetch, bucket: fastBucket(), logCall: noopLog },
      },
    );

    expect(fetchFn).not.toHaveBeenCalled();
    expect(prices.has("scam")).toBe(false); // -> «Нераспознанные»
  });

  it("fetchIfExpired: false — только чтение кэша (дашборд)", async () => {
    const { client } = fakeAdmin([
      { asset_id: "a1", price_usd: 40, fetched_at: EXPIRED_AT },
    ]);
    const fetchFn = vi.fn();

    const prices = await getPrices([erc20("a1", "ethereum", "0x" + "5".repeat(40), "tkn")], {
      admin: client,
      fetchIfExpired: false,
      nowMs: NOW,
      cg: { fetchFn: fetchFn as unknown as typeof fetch, bucket: fastBucket(), logCall: noopLog },
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(prices.get("a1")!.stale).toBe(true);
    expect(prices.get("a1")!.priceUsd).toBe(40);
  });

  it("нативный ETH идет через /simple/price, один id на 4 сети", async () => {
    const { client, upserted } = fakeAdmin([]);
    const fetchFn = vi.fn(async () => jsonResponse({ ethereum: { usd: 3000 } }));

    const natives: AssetForPricing[] = (["ethereum", "arbitrum", "base", "optimism"] as const).map(
      (chain) => ({
        id: `eth-${chain}`,
        chain,
        contract_address: null,
        kind: "native",
        coingecko_id: "ethereum",
      }),
    );

    const prices = await getPrices(natives, {
      admin: client,
      fetchIfExpired: true,
      nowMs: NOW,
      cg: { fetchFn: fetchFn as unknown as typeof fetch, bucket: fastBucket(), logCall: noopLog },
    });

    expect(fetchFn).toHaveBeenCalledTimes(1); // один батч на все 4 актива
    for (const n of natives) {
      expect(prices.get(n.id)!.priceUsd).toBe(3000);
    }
    expect(upserted).toHaveLength(4);
  });
});
