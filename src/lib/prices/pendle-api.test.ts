import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPendleMarkets,
  parseMarket,
  resetPendleApiCache,
  stripChainPrefix,
} from "./pendle-api";

/**
 * Справочник рынков Pendle. Фикстуры повторяют форму живого ответа
 * /core/v2/markets/all (проверено 19.10.2026): адреса токенов с префиксом
 * сети, address рынка — без, доходности — долями.
 */

const RAW = {
  address: "0x47AD2CD1DD15739A7A035B9D3B7828D916FEF77E",
  name: "sUSDe",
  expiry: "2026-11-26T00:00:00.000Z",
  pt: "1-0xb195b618ea52b77cb2a58846f452f59f8dfa9390",
  yt: "1-0xbf98480425a29197e5d99d003017f63a1e595d02",
  sy: "1-0x9d39a5de30e57443bff2a8307a4256c8797a3497",
  details: { impliedApy: 0.0501, underlyingApy: 0.042 },
};

function page(results: unknown[], total: number) {
  return { ok: true, status: 200, json: async () => ({ total, limit: 100, skip: 0, results }) };
}

const noLog = vi.fn(async () => {});

beforeEach(() => {
  resetPendleApiCache();
  noLog.mockClear();
});

describe("разбор записи рынка", () => {
  it("префикс сети снимается, регистр приводится, доли становятся процентами", () => {
    expect(parseMarket(RAW, 1)).toEqual({
      address: "0x47ad2cd1dd15739a7a035b9d3b7828d916fef77e",
      name: "sUSDe",
      expiry: "2026-11-26T00:00:00.000Z",
      pt: "0xb195b618ea52b77cb2a58846f452f59f8dfa9390",
      yt: "0xbf98480425a29197e5d99d003017f63a1e595d02",
      sy: "0x9d39a5de30e57443bff2a8307a4256c8797a3497",
      impliedApyPercent: expect.closeTo(5.01, 9),
      underlyingApyPercent: expect.closeTo(4.2, 9),
    });
  });

  it("адрес чужой сети не подменяется своим", () => {
    expect(stripChainPrefix("42161-0xb195b618ea52b77cb2a58846f452f59f8dfa9390", 1)).toBeNull();
  });

  it("рынок без адреса токена или даты погашения отбрасывается", () => {
    expect(parseMarket({ ...RAW, yt: undefined }, 1)).toBeNull();
    expect(parseMarket({ ...RAW, expiry: "скоро" }, 1)).toBeNull();
  });

  it("неизвестная доходность — null, а не ноль", () => {
    expect(parseMarket({ ...RAW, details: null }, 1)?.impliedApyPercent).toBeNull();
  });
});

describe("загрузка справочника", () => {
  it("читает все страницы по 100 с фильтром сети", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page(Array(100).fill(RAW), 101))
      .mockResolvedValueOnce(page([RAW], 101));
    const markets = await getPendleMarkets("ethereum", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logCall: noLog,
    });
    expect(markets).toHaveLength(101);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain("chainId=1&skip=0&limit=100");
    expect(fetchImpl.mock.calls[1][0]).toContain("skip=100");
  });

  it("истекшие рынки остаются: погашенный PT еще стоит денег", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(page([{ ...RAW, expiry: "2024-03-28T00:00:00.000Z" }], 1));
    const markets = await getPendleMarkets("ethereum", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logCall: noLog,
    });
    expect(markets).toHaveLength(1);
  });

  it("второй запрос в пределах TTL берется из кэша", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([RAW], 1));
    const opts = { fetchImpl: fetchImpl as unknown as typeof fetch, logCall: noLog, nowMs: 0 };
    await getPendleMarkets("ethereum", opts);
    await getPendleMarkets("ethereum", { ...opts, nowMs: 60_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("отказ API бросает: «неизвестно» не должно стать «пусто»", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    await expect(
      getPendleMarkets("ethereum", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        logCall: noLog,
      }),
    ).rejects.toThrow(/HTTP 429/);
    expect(noLog).toHaveBeenCalledWith("pendle", "markets:ethereum", { units: 1, ok: false });
  });

  it("неожиданная форма ответа — тоже отказ", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ message: "x" }) });
    await expect(
      getPendleMarkets("base", { fetchImpl: fetchImpl as unknown as typeof fetch, logCall: noLog }),
    ).rejects.toThrow(/unexpected/);
  });
});
