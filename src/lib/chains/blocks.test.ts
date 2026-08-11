import { describe, expect, it, vi } from "vitest";
import {
  BLOCK_TOLERANCE_SEC,
  MAX_BLOCK_PROBES,
  MAX_TIMESTAMP_READS,
  blockAtTimestamp,
  blockTimestamps,
  interpolateBlock,
  timestampFromSamples,
  type BlockRpcClient,
  type BlockWindow,
} from "./blocks";

/**
 * Синтетическая цепочка с заданным временем блока. Время целое, как у узла:
 * при субсекундных блоках у соседей оно совпадает — ровно так ведет себя
 * Arbitrum, и на этом ломается наивный поиск.
 */
function makeChain(secondsPerBlock: number, latestBlock: bigint) {
  const BASE = 1_700_000_000n;
  const timestampOf = (block: bigint) =>
    BASE + BigInt(Math.floor(Number(block) * secondsPerBlock));

  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    latestTimestamp: timestampOf(latestBlock),
    timestampOf,
    client: {
      async getBlock(args?: { blockNumber?: bigint }) {
        calls += 1;
        const block = args?.blockNumber ?? latestBlock;
        if (block < 0n || block > latestBlock) {
          throw new Error(`нет такого блока: ${block}`);
        }
        return { number: block, timestamp: timestampOf(block) };
      },
    },
  };
}

const DAY = 86_400n;

describe("interpolateBlock", () => {
  const anchor = { block: 1000n, timestamp: 12_000n };

  it("секущая через две пробы попадает в момент", () => {
    const other = { block: 900n, timestamp: 10_800n };
    expect(interpolateBlock(anchor, other, 11_400n, 1000n)).toBe(950n);
  });

  it("совпавшее время проб не делит на ноль", () => {
    const same = { block: 900n, timestamp: 12_000n };
    expect(interpolateBlock(anchor, same, 11_400n, 1000n)).toBeNull();
  });

  it("совпавший номер блока тоже не делит на ноль", () => {
    const same = { block: 1000n, timestamp: 10_800n };
    expect(interpolateBlock(anchor, same, 11_400n, 1000n)).toBeNull();
  });

  it("результат не уходит за голову цепочки и не становится отрицательным", () => {
    const other = { block: 900n, timestamp: 10_800n };
    expect(interpolateBlock(anchor, other, 99_999n, 1000n)).toBe(1000n);
    expect(interpolateBlock(anchor, other, 0n, 1000n)).toBe(0n);
  });
});

describe("blockAtTimestamp", () => {
  /** Сети с разным временем блока: 12 с, 2 с и субсекундные 0,25 с. */
  const chains: [name: string, secondsPerBlock: number, latest: bigint][] = [
    ["ethereum ~12 с", 12, 21_000_000n],
    ["base/optimism ~2 с", 2, 30_000_000n],
    ["arbitrum ~0,25 с", 0.25, 400_000_000n],
  ];

  for (const [name, spb, latestBlock] of chains) {
    it(`${name}: сходится в допуск за сутки назад`, async () => {
      const chain = makeChain(spb, latestBlock);
      const target = chain.latestTimestamp - DAY;

      const window = await blockAtTimestamp(chain.client, target);

      expect(window).not.toBeNull();
      const off = window!.from.timestamp - target;
      expect(off < 0n ? -off : off).toBeLessThanOrEqual(BLOCK_TOLERANCE_SEC);
      expect(chain.calls).toBeLessThanOrEqual(MAX_BLOCK_PROBES);
    });
  }

  it("совпадающее время у соседних блоков не зацикливает поиск", async () => {
    // 4 блока в секунду: у каждой четверки время одинаковое
    const chain = makeChain(0.25, 400_000_000n);
    const window = await blockAtTimestamp(
      chain.client,
      chain.latestTimestamp - DAY,
    );

    expect(window).not.toBeNull();
    expect(Number.isNaN(Number(window!.from.block))).toBe(false);
    expect(chain.calls).toBeLessThanOrEqual(MAX_BLOCK_PROBES);
  });

  it("голова цепочки возвращается вместе с найденным блоком", async () => {
    const chain = makeChain(12, 21_000_000n);
    const window = await blockAtTimestamp(
      chain.client,
      chain.latestTimestamp - DAY,
    );

    expect(window!.latest.block).toBe(21_000_000n);
    expect(window!.latest.timestamp).toBe(chain.latestTimestamp);
    expect(window!.from.block).toBeLessThan(window!.latest.block);
  });

  it("никогда не выходит за границы цепочки", async () => {
    // Цепочка моложе суток: назад идти некуда
    const chain = makeChain(12, 100n);
    const window = await blockAtTimestamp(
      chain.client,
      chain.latestTimestamp - DAY,
    );

    expect(window).not.toBeNull();
    expect(window!.from.block).toBeGreaterThanOrEqual(0n);
    expect(window!.from.block).toBeLessThanOrEqual(100n);
  });

  it("момент в будущем — окна нет, обе границы совпадают с головой", async () => {
    const chain = makeChain(12, 21_000_000n);
    const window = await blockAtTimestamp(
      chain.client,
      chain.latestTimestamp + DAY,
    );

    expect(window!.from.block).toBe(window!.latest.block);
    expect(chain.calls).toBe(1);
  });

  it("отказ узла не бросает наружу лишнего — окно просто не читается", async () => {
    const failing = {
      async getBlock() {
        throw new Error("missing trie node");
      },
    };
    await expect(blockAtTimestamp(failing, 1n)).rejects.toThrow();
  });
});

/**
 * Обратное преобразование «номер блока → время» (Фаза 8, S8.5).
 *
 * Нужно поиску операций с GM: номер блока приходит в логе, а на экране
 * должна стоять дата. Спросить заголовок у узла точнее, но дороже, и бюджет
 * запросов на это один на весь поиск.
 */
describe("timestampFromSamples", () => {
  const from = { block: 1_000n, timestamp: 12_000n };
  const latest = { block: 2_000n, timestamp: 24_000n };

  it("секущая через две пробы даёт время блока между ними", () => {
    expect(timestampFromSamples(latest, from, 1_500n)).toBe(18_000n);
  });

  it("на самих пробах совпадает с их временем", () => {
    expect(timestampFromSamples(latest, from, 1_000n)).toBe(12_000n);
    expect(timestampFromSamples(latest, from, 2_000n)).toBe(24_000n);
  });

  it("совпавшее время проб не делит на ноль", () => {
    expect(
      timestampFromSamples({ block: 2_000n, timestamp: 12_000n }, from, 1_500n),
    ).toBeNull();
  });

  it("совпавший номер блока тоже не делит на ноль", () => {
    expect(
      timestampFromSamples({ block: 1_000n, timestamp: 24_000n }, from, 1_500n),
    ).toBeNull();
  });

  it("обратно к interpolateBlock: одна и та же секущая в обе стороны", () => {
    const block = interpolateBlock(latest, from, 20_400n, latest.block);
    expect(block).toBe(1_700n);
    expect(timestampFromSamples(latest, from, block!)).toBe(20_400n);
  });
});

describe("blockTimestamps", () => {
  const samples: BlockWindow = {
    from: { block: 1_000n, timestamp: 12_000n },
    latest: { block: 2_000n, timestamp: 24_000n },
  };
  /** Настоящее время блока намеренно отличается от секущей: видно, что читалось. */
  const trueTime = (block: bigint) => 12_000n + (block - 1_000n) * 12n + 7n;

  function client(): BlockRpcClient & { getBlock: ReturnType<typeof vi.fn> } {
    const getBlock = vi.fn(async ({ blockNumber }: { blockNumber?: bigint } = {}) => ({
      number: blockNumber ?? 2_000n,
      timestamp: trueTime(blockNumber ?? 2_000n),
    }));
    return { getBlock };
  }

  it("время читается у узла и помечается точным", async () => {
    const rpc = client();
    const times = await blockTimestamps(rpc, [1_500n, 1_600n], samples);

    expect(times.get("1500")).toEqual({ sec: trueTime(1_500n), exact: true });
    expect(times.get("1600")).toEqual({ sec: trueTime(1_600n), exact: true });
    expect(rpc.getBlock).toHaveBeenCalledTimes(2);
  });

  it("повторяющиеся блоки читаются один раз", async () => {
    const rpc = client();
    // Продажа и покупка на одном уровне попадают в один блок — обычное дело
    const times = await blockTimestamps(rpc, [1_500n, 1_500n, 1_500n], samples);

    expect(rpc.getBlock).toHaveBeenCalledTimes(1);
    expect(times.size).toBe(1);
    expect(times.get("1500")?.exact).toBe(true);
  });

  it("сверх бюджета чтений — интерполяция и честное «время приблизительное»", async () => {
    const rpc = client();
    const blocks = Array.from(
      { length: MAX_TIMESTAMP_READS + 3 },
      (_, i) => 1_100n + BigInt(i),
    );

    const times = await blockTimestamps(rpc, blocks, samples);

    // Бюджет соблюдён: тысяча найденных трансферов не превращается
    // в тысячу запросов заголовков
    expect(rpc.getBlock).toHaveBeenCalledTimes(MAX_TIMESTAMP_READS);
    expect(times.size).toBe(blocks.length);

    for (const block of blocks.slice(0, MAX_TIMESTAMP_READS)) {
      expect(times.get(block.toString())).toEqual({
        sec: trueTime(block),
        exact: true,
      });
    }
    for (const block of blocks.slice(MAX_TIMESTAMP_READS)) {
      expect(times.get(block.toString())).toEqual({
        sec: timestampFromSamples(samples.latest, samples.from, block),
        exact: false,
      });
    }
  });

  it("отказ узла по одному блоку не теряет строку: остаётся приблизительное время", async () => {
    const rpc = client();
    rpc.getBlock.mockImplementation(async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
      if (blockNumber === 1_500n) throw new Error("missing trie node");
      return { number: blockNumber!, timestamp: trueTime(blockNumber!) };
    });

    const times = await blockTimestamps(rpc, [1_500n, 1_600n], samples);

    expect(times.get("1500")).toEqual({ sec: 18_000n, exact: false });
    expect(times.get("1600")).toEqual({ sec: trueTime(1_600n), exact: true });
  });

  it("вырожденные пробы: блока в ответе нет — «время неизвестно», а не выдуманное", async () => {
    const rpc = client();
    rpc.getBlock.mockRejectedValue(new Error("RPC down"));
    const flat: BlockWindow = {
      from: { block: 1_000n, timestamp: 24_000n },
      latest: { block: 2_000n, timestamp: 24_000n },
    };

    const times = await blockTimestamps(rpc, [1_500n], flat);
    expect(times.has("1500")).toBe(false);
  });

  it("пустой список блоков не ходит в сеть", async () => {
    const rpc = client();
    expect((await blockTimestamps(rpc, [], samples)).size).toBe(0);
    expect(rpc.getBlock).not.toHaveBeenCalled();
  });
});
