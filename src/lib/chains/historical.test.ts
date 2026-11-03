import { describe, expect, it, vi } from "vitest";
import { pinChainsAt, pinClientToBlock, type SourceClient } from "./historical";
import { CHAIN_IDS } from "./config";

/**
 * Прибивание клиента к блоку — весь механизм восстановления истории держится
 * на нём: если blockNumber где-то не доехал, читатель молча вернёт состояние
 * «сейчас», и точка за прошлую дату окажется копией сегодняшней.
 */

/** Клиент-двойник: отвечает заготовками и запоминает, с чем его позвали. */
function fakeClient(opts: { blockTime?: (block: bigint) => bigint } = {}) {
  const calls: { method: string; args: unknown }[] = [];
  const latest = 1_000_000n;
  // Один блок в секунду — чтобы ожидаемый номер считался в уме
  const timeOf = opts.blockTime ?? ((block: bigint) => block);

  const client: SourceClient = {
    getBalance: async (args) => {
      calls.push({ method: "getBalance", args });
      return 0n;
    },
    multicall: async (args) => {
      calls.push({ method: "multicall", args });
      return [];
    },
    readContract: async (args) => {
      calls.push({ method: "readContract", args });
      return null;
    },
    getBlock: async (args) => {
      calls.push({ method: "getBlock", args });
      const block = args?.blockNumber ?? latest;
      return { number: block, timestamp: timeOf(block) };
    },
  };
  return { client, calls, latest };
}

describe("pinClientToBlock", () => {
  it("подставляет номер блока во все чтения состояния", async () => {
    const { client, calls } = fakeClient();
    const pinned = pinClientToBlock(client, 777n);

    await pinned.getBalance({ address: "0x1" as `0x${string}` });
    await pinned.multicall({ contracts: [], allowFailure: true });
    await pinned.readContract({ address: "0x2" });

    for (const call of calls) {
      expect(
        (call.args as { blockNumber?: bigint }).blockNumber,
        `${call.method} ушёл без номера блока`,
      ).toBe(777n);
    }
  });

  it("не перебивает блок, выбранный самим вызывающим", async () => {
    // Uniswap читает аккумуляторы комиссий на ДВУХ конкретных блоках.
    // Общий пин поверх них сравнил бы блок сам с собой и дал бы нулевые
    // комиссии там, где их просто не измеряли
    const { client, calls } = fakeClient();
    const pinned = pinClientToBlock(client, 777n);

    await pinned.multicall({ contracts: [], blockNumber: 500n });

    expect((calls[0].args as { blockNumber: bigint }).blockNumber).toBe(500n);
  });

  it("на getBlock() без аргументов отвечает прибитым блоком, а не головой", async () => {
    // Иначе окно «сутки назад» внутри читателя отмерялось бы от сегодня —
    // то есть от данных, которых на восстанавливаемую дату не существовало
    const { client } = fakeClient();
    const pinned = pinClientToBlock(client, 777n);

    const head = await pinned.getBlock();

    expect(head.number).toBe(777n);
  });
});

describe("pinChainsAt", () => {
  const target = 900_000n;

  it("находит блок на каждой сети и отдаёт промах по времени", async () => {
    const clients = Object.fromEntries(
      CHAIN_IDS.map((chain) => [chain, fakeClient().client]),
    );

    const result = await pinChainsAt(target, { clients });

    for (const chain of CHAIN_IDS) {
      const pin = result.blocks[chain];
      expect(pin, `${chain} без блока`).toBeDefined();
      // Время блока равно его номеру — значит попали ровно
      expect(pin!.block).toBe(target);
      expect(pin!.driftSec).toBe(0);
    }
    expect(result.failed).toEqual([]);
  });

  it("отказ одной сети не отменяет остальные", async () => {
    const broken: SourceClient = {
      ...fakeClient().client,
      getBlock: vi.fn(async () => {
        throw new Error("архив недоступен");
      }),
    };
    const clients = Object.fromEntries(
      CHAIN_IDS.map((chain) => [
        chain,
        chain === "optimism" ? broken : fakeClient().client,
      ]),
    );

    const result = await pinChainsAt(target, { clients });

    expect(result.failed).toEqual([
      { chain: "optimism", error: "архив недоступен" },
    ]);
    expect(result.blocks.optimism).toBeUndefined();
    expect(result.blocks.ethereum).toBeDefined();
  });

  it("отказывается выдавать «историю» за момент в будущем", async () => {
    // Голова цепочки старше запрошенного момента: blockAtTimestamp честно
    // вернёт голову, и снепшот «за прошлую дату» оказался бы текущим
    const clients = Object.fromEntries(
      CHAIN_IDS.map((chain) => [chain, fakeClient().client]),
    );

    const result = await pinChainsAt(2_000_000n, { clients });

    expect(result.blocks.ethereum).toBeUndefined();
    expect(result.failed.map((f) => f.error)).toContain(
      "запрошенный момент не в прошлом этой сети",
    );
  });
});
