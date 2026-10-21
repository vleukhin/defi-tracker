import { describe, expect, it, vi } from "vitest";
import {
  findHeldSince,
  parseAlchemyPage,
  parseLogs,
  type HeldSinceDeps,
  type HeldSinceRpcClient,
} from "./pendle-held";

/**
 * Поиск даты покупки по истории переводов. Сеть подменена: Alchemy —
 * через fetchFn, узел — через request/getBlock.
 */

const TOKEN = "0xba96292ee7673e3b546cc90db6d97111cd9a314f";
const WALLET = "0x00000000000000000000000000000000000000aa";

const transfer = (block: number, value: number, iso: string, log = 1) => ({
  blockNum: `0x${block.toString(16)}`,
  uniqueId: `0xhash:log:${log}`,
  rawContract: { value: `0x${value.toString(16)}` },
  metadata: { blockTimestamp: iso },
});

function alchemyFetch(sides: { in: unknown[]; out: unknown[] }): typeof fetch {
  return vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body));
    const side = "toAddress" in body.params[0] ? "in" : "out";
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: { transfers: sides[side] } }),
    };
  }) as unknown as typeof fetch;
}

function deps(over: Partial<HeldSinceDeps> = {}, client?: Partial<HeldSinceRpcClient>): HeldSinceDeps {
  return {
    fetchFn: alchemyFetch({ in: [], out: [] }),
    alchemyUrl: () => "https://alchemy.test",
    client: () => ({
      request: vi.fn(async () => []),
      getBlock: vi.fn(async () => ({ timestamp: 0n })),
      ...client,
    }),
    logCall: vi.fn(async () => {}),
    ...over,
  };
}

describe("разбор ответов", () => {
  it("Alchemy: количество из rawContract.value, индекс лога из uniqueId", () => {
    const page = parseAlchemyPage(
      { transfers: [transfer(100, 5, "2026-09-01T10:00:00.000Z", 7)], pageKey: "k" },
      "in",
    );
    expect(page.pageKey).toBe("k");
    expect(page.transfers[0]).toMatchObject({ block: 100n, logIndex: 7, amount: 5n, direction: "in" });
    expect(page.transfers[0].timestampSec).toBe(BigInt(Date.parse("2026-09-01T10:00:00.000Z") / 1000));
  });

  it("логи: количество из data, времени блока нет — достаётся отдельно", () => {
    const [log] = parseLogs([{ blockNumber: "0x64", logIndex: "0x2", data: "0x0a" }], "out");
    expect(log).toEqual({ block: 100n, logIndex: 2, direction: "out", amount: 10n, timestampSec: null });
  });

  it("не массив — ошибка, а не «переводов нет»", () => {
    expect(() => parseLogs({ message: "range too wide" }, "in")).toThrow();
  });
});

describe("дата покупки", () => {
  it("через Alchemy: начало текущего удержания", async () => {
    const d = deps({
      fetchFn: alchemyFetch({
        in: [
          transfer(100, 50, "2026-08-20T00:00:00.000Z"),
          transfer(300, 10, "2026-09-15T00:00:00.000Z"),
        ],
        out: [transfer(150, 50, "2026-08-25T00:00:00.000Z")],
      }),
    });
    expect(await findHeldSince("ethereum", TOKEN, WALLET, d)).toBe("2026-09-15T00:00:00.000Z");
  });

  it("Alchemy отказала — запасной путь по логам и время блока с узла", async () => {
    const request = vi.fn(async (args: { params: [{ topics: unknown[] }] }) =>
      args.params[0].topics.length === 3
        ? [{ blockNumber: "0x64", logIndex: "0x0", data: "0x32" }]
        : [],
    );
    const getBlock = vi.fn(async () => ({ timestamp: 1_788_000_000n }));
    const d = deps(
      {
        fetchFn: vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch,
      },
      { request: request as unknown as HeldSinceRpcClient["request"], getBlock },
    );
    expect(await findHeldSince("arbitrum", TOKEN, WALLET, d)).toBe(
      new Date(1_788_000_000_000).toISOString(),
    );
    expect(getBlock).toHaveBeenCalledWith({ blockNumber: 100n });
  });

  it("без ключа Alchemy сразу идёт по логам", async () => {
    const fetchFn = vi.fn();
    const d = deps({ alchemyUrl: () => null, fetchFn: fetchFn as unknown as typeof fetch });
    expect(await findHeldSince("base", TOKEN, WALLET, d)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("оба пути отказали — null, а не дата запуска рынка и не «сегодня»", async () => {
    const d = deps(
      { fetchFn: vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch },
      { request: vi.fn(async () => { throw new Error("range"); }) },
    );
    expect(await findHeldSince("ethereum", TOKEN, WALLET, d)).toBeNull();
  });
});
