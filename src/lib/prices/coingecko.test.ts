import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenBucket } from "./token-bucket";
import { fetchNativePrices, fetchTokenPrices } from "./coingecko";

/** Быстрый bucket без ожиданий для тестов. */
const fastBucket = () => new TokenBucket(1000, 1000, () => 0);
const noopLog = vi.fn(async () => {});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("fetchTokenPrices", () => {
  it("батчит адреса, ключует lowercase, пропускает адреса без листинга", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        "0xaaa0000000000000000000000000000000000001": { usd: 2.5 },
        "0xAAA0000000000000000000000000000000000002": { usd: 1 },
        // третий адрес отсутствует в ответе — нет листинга
      }),
    );

    const prices = await fetchTokenPrices(
      "arbitrum-one",
      [
        "0xaaa0000000000000000000000000000000000001",
        "0xaaa0000000000000000000000000000000000002",
        "0xaaa0000000000000000000000000000000000003",
      ],
      { fetchFn: fetchFn as unknown as typeof fetch, bucket: fastBucket(), logCall: noopLog },
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/api/v3/simple/token_price/arbitrum-one");
    expect(url.searchParams.get("vs_currencies")).toBe("usd");

    expect(prices["0xaaa0000000000000000000000000000000000001"]).toBe(2.5);
    expect(prices["0xaaa0000000000000000000000000000000000002"]).toBe(1);
    expect(prices["0xaaa0000000000000000000000000000000000003"]).toBeUndefined();
  });

  it("делит больше 100 адресов на несколько вызовов", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}));
    const addresses = Array.from(
      { length: 150 },
      (_, i) => `0x${String(i).padStart(40, "0")}`,
    );
    await fetchTokenPrices("ethereum", addresses, {
      fetchFn: fetchFn as unknown as typeof fetch,
      bucket: fastBucket(),
      logCall: noopLog,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(firstUrl.searchParams.get("contract_addresses")!.split(",")).toHaveLength(100);
  });

  it("бросает ошибку при HTTP-сбое (не 429)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "nope" }, 500));
    await expect(
      fetchTokenPrices("base", ["0x" + "1".repeat(40)], {
        fetchFn: fetchFn as unknown as typeof fetch,
        bucket: fastBucket(),
        logCall: noopLog,
      }),
    ).rejects.toThrow("HTTP 500");
  });

  it("повторяет один раз после 429 с backoff", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({}, 429))
        .mockResolvedValueOnce(jsonResponse({ ["0x" + "1".repeat(40)]: { usd: 7 } }));

      const promise = fetchTokenPrices("ethereum", ["0x" + "1".repeat(40)], {
        fetchFn: fetchFn as unknown as typeof fetch,
        bucket: fastBucket(),
        logCall: noopLog,
      });
      await vi.advanceTimersByTimeAsync(15_000);
      const prices = await promise;
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(prices["0x" + "1".repeat(40)]).toBe(7);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("fetchNativePrices", () => {
  it("дедуплицирует id и возвращает цены по id", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ethereum: { usd: 3200 } }));
    const prices = await fetchNativePrices(["ethereum", "ethereum"], {
      fetchFn: fetchFn as unknown as typeof fetch,
      bucket: fastBucket(),
      logCall: noopLog,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/api/v3/simple/price");
    expect(url.searchParams.get("ids")).toBe("ethereum");
    expect(prices.ethereum).toBe(3200);
  });

  it("пустой список id — без сетевых вызовов", async () => {
    const fetchFn = vi.fn();
    const prices = await fetchNativePrices([], {
      fetchFn: fetchFn as unknown as typeof fetch,
      bucket: fastBucket(),
      logCall: noopLog,
    });
    expect(prices).toEqual({});
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
