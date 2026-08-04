import { describe, expect, it } from "vitest";
import {
  BLOCK_TOLERANCE_SEC,
  MAX_BLOCK_PROBES,
  blockAtTimestamp,
  interpolateBlock,
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
