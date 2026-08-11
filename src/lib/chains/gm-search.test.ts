import { describe, expect, it, vi } from "vitest";
import { findGmTransfers, type GmSearchDeps, type GmSearchRpcClient } from "./gm-search";
import {
  GM_SEARCH_DAYS,
  TRANSFER_TOPIC,
  ZERO_ADDRESS,
  ZERO_TOPIC,
  addressTopic,
} from "./gm-transfers";
import { MAX_BLOCK_PROBES } from "./blocks";

/**
 * Оркестратор поиска операций с GM (Фаза 8, S8.5).
 *
 * Здесь проверяется ровно то, чего нет в чистом ядре: два пути к данным,
 * бюджет времени и — главное — что ответ никогда не превращается в исключение.
 * Разница между «операций не было» и «спросить не смогли» и есть половина
 * смысла S8.5, и она видна только отсюда.
 */

const WALLET = "0x1111111111111111111111111111111111111111";
const GM_TOKEN = "0x47c031236e19d024b42f8AE6780E44A573170703";
const ALCHEMY_URL = "https://arb-mainnet.g.alchemy.com/v2/ключ";

/** Arbitrum: четыре блока в секунду, голова — «сейчас». */
const LATEST_BLOCK = 400_000_000n;
const NOW_SEC = 1_700_000_000n;
const NOW_MS = Number(NOW_SEC) * 1000;
const SEARCH_SEC = BigInt(GM_SEARCH_DAYS) * 86_400n;
/** Блок 14-суточной давности: номинальный пол поиска. */
const FLOOR_BLOCK = LATEST_BLOCK - SEARCH_SEC * 4n;

const timestampOf = (block: bigint) => NOW_SEC - (LATEST_BLOCK - block) / 4n;
const iso = (sec: bigint) => new Date(Number(sec) * 1000).toISOString();

/** Блок операции: примерно трое суток назад, внутри первого же окна скана. */
const HIT_BLOCK = LATEST_BLOCK - 300_000n;
const HIT_SEC = timestampOf(HIT_BLOCK);
const TX = `0x${"ab".repeat(32)}`;

// --- Тестовые двойники ---

function makeClient(over: Partial<GmSearchRpcClient> = {}) {
  const blocksRead: bigint[] = [];
  const getBlock = vi.fn(async (args?: { blockNumber?: bigint }) => {
    const block = args?.blockNumber ?? LATEST_BLOCK;
    blocksRead.push(block);
    return { number: block, timestamp: timestampOf(block) };
  });
  const request = vi.fn(async () => [] as unknown);
  return { getBlock, request, blocksRead, ...over } as GmSearchRpcClient & {
    getBlock: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    blocksRead: bigint[];
  };
}

/** Ответ alchemy_getAssetTransfers: mint кошельку. */
function alchemyBody(transfers: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: "2.0", id: 1, result: { transfers } }),
  } as unknown as Response;
}

/**
 * Двойник fetch с ЯВНЫМИ параметрами: без них mock.calls типизируется пустым
 * кортежем, и проверить init (signal, method, body) было бы нечем.
 */
function alchemyFetch(transfers: unknown[]) {
  return vi.fn(async (_url: string, _init: RequestInit) => alchemyBody(transfers));
}

function mintTransfer(over: Record<string, unknown> = {}) {
  return {
    hash: TX,
    uniqueId: `${TX}:log:5`,
    blockNum: `0x${HIT_BLOCK.toString(16)}`,
    from: ZERO_ADDRESS,
    to: WALLET,
    value: 1.0000000000000002, // float Alchemy — его брать нельзя
    rawContract: { value: `0x${(10n ** 18n + 1n).toString(16)}`, decimal: "0x12" },
    metadata: { blockTimestamp: new Date(Number(HIT_SEC) * 1000).toISOString() },
    ...over,
  };
}

/** Лог eth_getLogs: burn с кошелька. */
function burnLog(over: Record<string, unknown> = {}) {
  return {
    transactionHash: TX,
    logIndex: "0x7",
    blockNumber: `0x${HIT_BLOCK.toString(16)}`,
    topics: [TRANSFER_TOPIC, addressTopic(WALLET), ZERO_TOPIC],
    data: `0x${(2n * 10n ** 18n).toString(16)}`,
    ...over,
  };
}

const ARGS = {
  gmToken: GM_TOKEN,
  wallet: WALLET,
  longSymbol: "ETH",
  coingeckoId: "ethereum",
};

function makeDeps(over: Partial<GmSearchDeps> = {}) {
  const client = makeClient();
  const fetchFn = vi.fn(async () => alchemyBody([])) as unknown as typeof fetch;
  const logCall = vi.fn(async () => {});
  const fetchRange = vi.fn(async () => ({
    points: [[Number(HIT_SEC) * 1000, 2_345.67]] as [number, number][],
    stepSec: 300,
  }));

  const deps: GmSearchDeps = {
    client,
    fetchFn,
    alchemyUrl: ALCHEMY_URL,
    logCall: logCall as unknown as GmSearchDeps["logCall"],
    nowMs: () => NOW_MS,
    deadlineMs: NOW_MS + 22_000,
    cg: { fetchRange },
    ...over,
  };
  return { deps, client: deps.client as ReturnType<typeof makeClient>, fetchRange };
}

// --- Первичный путь ---

describe("findGmTransfers: путь Alchemy", () => {
  it("два запроса, время из withMetadata, заголовки блоков не читаются", async () => {
    const { deps, client, fetchRange } = makeDeps();
    const fetchFn = alchemyFetch([mintTransfer()]);
    deps.fetchFn = fetchFn as unknown as typeof fetch;

    const res = await findGmTransfers(ARGS, deps);

    expect(res.status).toBe("found");
    expect(res.source).toBe("alchemy");
    expect(res.reason).toBeNull();
    expect(res.searchDays).toBe(GM_SEARCH_DAYS);

    // Две стороны кошелька: mint приходит ему, burn уходит от него
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const sides = fetchFn.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)),
    );
    expect(sides[0].params[0].toAddress).toBe(WALLET.toLowerCase());
    expect(sides[1].params[0].fromAddress).toBe(WALLET.toLowerCase());

    // Время блока приехало вместе с трансфером — второй раз в сеть не ходим
    expect(client.blocksRead).not.toContain(HIT_BLOCK);
    expect(client.getBlock.mock.calls.length).toBeLessThanOrEqual(MAX_BLOCK_PROBES);
    expect(client.request).not.toHaveBeenCalled();

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      key: `${TX}:5`,
      kind: "buy",
      // Не 1.0000000000000002 из поля value: количество берётся из rawContract
      gmAmount: "1.000000000000000001",
      happenedAt: iso(HIT_SEC),
      timeApproximate: false,
      assetPriceUsd: 2_345.67,
      priceStepSec: 300,
    });
    expect(fetchRange).toHaveBeenCalledTimes(1);
  });

  it("каждому запросу к Alchemy выдан AbortSignal: зависший провайдер не вечен", async () => {
    const { deps } = makeDeps();
    const fetchFn = alchemyFetch([]);
    deps.fetchFn = fetchFn as unknown as typeof fetch;

    await findGmTransfers(ARGS, deps);

    for (const call of fetchFn.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal!.aborted).toBe(false);
      expect(init.method).toBe("POST");
    }
  });

  it("пусто у Alchemy — это «операций не было», а не отказ", async () => {
    const { deps, client } = makeDeps();
    const res = await findGmTransfers(ARGS, deps);

    expect(res.status).toBe("empty");
    expect(res.rows).toEqual([]);
    expect(res.reason).toBeNull();
    expect(res.source).toBe("alchemy");
    // Окно просмотрено целиком: сказать «за 14 дней ничего» можно честно
    expect(res.window).toEqual({
      fromIso: iso(timestampOf(FLOOR_BLOCK)),
      toIso: iso(NOW_SEC),
      fromBlock: Number(FLOOR_BLOCK),
      toBlock: Number(LATEST_BLOCK),
    });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("uniqueId не разобрался — продажа с откупом в одной транзакции всё равно две строки", async () => {
    // Базовый сценарий §5. Если обеим сторонам дать один и тот же logIndex,
    // дедупликация склеит их, и на экране останется одна операция
    const { deps } = makeDeps();
    deps.fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const side = JSON.parse(String(init.body)).params[0];
      return alchemyBody([
        side.toAddress
          ? mintTransfer({ uniqueId: undefined })
          : mintTransfer({
              uniqueId: null,
              from: WALLET,
              to: ZERO_ADDRESS,
              rawContract: { value: `0x${(3n * 10n ** 18n).toString(16)}` },
            }),
      ]);
    }) as unknown as typeof fetch;

    const res = await findGmTransfers(ARGS, deps);

    expect(res.rows).toHaveLength(2);
    expect(res.rows.map((r) => r.kind).sort()).toEqual(["buy", "sell"]);
    expect(new Set(res.rows.map((r) => r.key)).size).toBe(2);
    expect(res.rows.every((r) => r.txHash === TX)).toBe(true);
  });

  it("окно запроса — ровно 14 суток по блокам", async () => {
    const { deps } = makeDeps();
    const fetchFn = alchemyFetch([]);
    deps.fetchFn = fetchFn as unknown as typeof fetch;

    await findGmTransfers(ARGS, deps);
    const params = JSON.parse(String((fetchFn.mock.calls[0][1] as RequestInit).body))
      .params[0];

    expect(BigInt(params.fromBlock)).toBe(FLOOR_BLOCK);
    expect(BigInt(params.toBlock)).toBe(LATEST_BLOCK);
  });
});

// --- Запасной путь ---

describe("findGmTransfers: запасной путь eth_getLogs", () => {
  it("ключа Alchemy нет — идём сразу к узлу", async () => {
    const { deps, client } = makeDeps({ alchemyUrl: null });
    client.request.mockResolvedValueOnce([burnLog()]);

    const res = await findGmTransfers(ARGS, deps);

    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(client.request).toHaveBeenCalled();
    expect(client.request.mock.calls[0][0].method).toBe("eth_getLogs");
    expect(res.source).toBe("logs");
    expect(res.status).toBe("found");
    expect(res.rows[0]).toMatchObject({ kind: "sell", gmAmount: "2" });
    // На этом пути времени в логе нет — читаем заголовок блока
    expect(client.blocksRead).toContain(HIT_BLOCK);
    expect(res.rows[0].happenedAt).toBe(iso(timestampOf(HIT_BLOCK)));
    expect(res.rows[0].timeApproximate).toBe(false);
  });

  const failures: [name: string, deps: () => Partial<GmSearchDeps>][] = [
    [
      "HTTP 500",
      () => ({
        fetchFn: vi.fn(async () => ({
          ok: false,
          status: 500,
          json: async () => ({}),
        })) as unknown as typeof fetch,
      }),
    ],
    [
      "ошибка в теле JSON-RPC",
      () => ({
        fetchFn: vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({ error: { code: -32600, message: "bad request" } }),
        })) as unknown as typeof fetch,
      }),
    ],
    [
      "fetch бросает асинхронно",
      () => ({
        fetchFn: vi.fn(async () => {
          throw new Error("ECONNRESET");
        }) as unknown as typeof fetch,
      }),
    ],
    [
      "fetch бросает синхронно",
      () => ({
        fetchFn: (() => {
          throw new Error("сломался до промиса");
        }) as unknown as typeof fetch,
      }),
    ],
  ];

  for (const [name, override] of failures) {
    it(`Alchemy отказала (${name}) — падаем на eth_getLogs, а не наружу`, async () => {
      const { deps, client } = makeDeps(override());
      client.request.mockResolvedValueOnce([burnLog()]);

      const res = await findGmTransfers(ARGS, deps);

      expect(client.request).toHaveBeenCalled();
      expect(res.source).toBe("logs");
      expect(res.status).toBe("found");
      expect(res.rows).toHaveLength(1);
    });
  }

  it("узел не тянет диапазон — «не поддерживает», а не «операций нет»", async () => {
    const { deps, client } = makeDeps({ alchemyUrl: null });
    client.request.mockRejectedValue(new Error("block range is too wide"));

    const res = await findGmTransfers(ARGS, deps);

    expect(res.status).toBe("unsupported");
    expect(res.reason).toBe("range_unsupported");
    expect(res.rows).toEqual([]);
    // Окно ужимается вдвое от 345 600 до пола в 1 000 блоков
    expect(client.request.mock.calls.length).toBe(9);
  });

  it("незнакомая ошибка узла без единого успеха — «спросить не смогли»", async () => {
    const { deps, client } = makeDeps({ alchemyUrl: null });
    client.request.mockRejectedValue(new Error("execution reverted"));

    const res = await findGmTransfers(ARGS, deps);

    expect(res.status).toBe("unavailable");
    expect(res.reason).toBe("provider_error");
    expect(res.source).toBe("none");
    // Гадать по незнакомой ошибке нельзя: один запрос, и хватит
    expect(client.request).toHaveBeenCalledTimes(1);
    // Оборвались, не посмотрев ничего, — окно обязано сказать именно это,
    // а не сослаться на номинальный пол четырнадцати суток
    expect(res.window!.fromBlock).toBe(Number(LATEST_BLOCK));
    expect(res.window!.fromIso).toBe(res.window!.toIso);
  });

  it("обрыв после части окна — окно называет достигнутый блок, а не пол", async () => {
    // Первое окно прошло, второе упало незнакомой ошибкой. Скан завершается
    // без терминала (done === null), и именно эта ветка когда-то подставляла
    // в ответ номинальные 14 суток: «за две недели ничего» — не посмотрев
    // за две недели. Регрессия на gm-search.ts:459
    const { deps, client } = makeDeps({ alchemyUrl: null });
    client.request
      .mockResolvedValueOnce([])
      .mockRejectedValue(new Error("execution reverted"));

    const res = await findGmTransfers(ARGS, deps);

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(res.status).toBe("partial");
    // Успели просмотреть верхнюю часть окна — граница строго выше пола
    // и строго ниже головы, а само окно не вывернуто
    expect(res.window!.fromBlock).toBeGreaterThan(Number(FLOOR_BLOCK));
    expect(res.window!.fromBlock).toBeLessThan(Number(LATEST_BLOCK));
    expect(res.window!.fromBlock).toBeLessThanOrEqual(res.window!.toBlock);
    expect(Date.parse(res.window!.fromIso)).toBeGreaterThan(
      Date.parse(iso(timestampOf(FLOOR_BLOCK))),
    );
  });
});

// --- Границы просмотренного окна ---

describe("findGmTransfers: границы окна", () => {
  it("оборвались по сроку — окно называет достигнутый блок, а не номинальные 14 суток", async () => {
    // Регрессия: подставить сюда нижнюю границу поиска значило бы сказать
    // «за две недели ничего», не посмотрев за две недели
    let now = NOW_MS;
    const { deps, client } = makeDeps({
      alchemyUrl: null,
      nowMs: () => now,
      deadlineMs: NOW_MS + 10_000,
    });
    client.request.mockImplementation(async () => {
      if (client.request.mock.calls.length >= 3) now = NOW_MS + 10_001;
      return [];
    });

    const res = await findGmTransfers(ARGS, deps);

    expect(res.status).toBe("partial");
    expect(res.reason).toBe("deadline");
    // Три окна: 345 600 + 691 200 + 1 382 400 блоков от головы
    const reached = LATEST_BLOCK - 2_419_200n + 1n;
    expect(res.window?.fromBlock).toBe(Number(reached));
    expect(res.window?.fromBlock).toBeGreaterThan(Number(FLOOR_BLOCK));
    expect(res.window?.fromIso).toBe(iso(NOW_SEC - 604_800n));
    expect(res.window?.toBlock).toBe(Number(LATEST_BLOCK));
  });

  it("бюджет запросов исчерпан — partial с причиной «request_budget»", async () => {
    const { deps, client } = makeDeps({ alchemyUrl: null });
    // Узел, который на каждое второе окно жалуется и подсказывает две тысячи
    // блоков. Скан идёт, но по две тысячи за раз до пола не дойти — и вот это
    // «дошли не до конца» должно называться, а не выглядеть как «ничего нет»
    client.request.mockImplementation(async () => {
      if (client.request.mock.calls.length % 2 === 1) {
        throw new Error(
          "Log response size exceeded. this block range should work: [0x0, 0x7d0]",
        );
      }
      return [];
    });

    const res = await findGmTransfers(ARGS, deps);

    expect(res.status).toBe("partial");
    expect(res.reason).toBe("request_budget");
    expect(client.request.mock.calls.length).toBe(24);
    // Просмотрено немного, но честно: верх окна прочитан, пол — нет
    expect(res.window!.toBlock).toBe(Number(LATEST_BLOCK));
    expect(res.window!.fromBlock).toBeLessThan(Number(LATEST_BLOCK));
    expect(res.window!.fromBlock).toBeGreaterThan(Number(FLOOR_BLOCK));
  });

  it("ни одного успешного запроса — покрытие нулевое, а не перевёрнутое окно", async () => {
    const { deps, client } = makeDeps({
      alchemyUrl: null,
      // Срок вышел ещё до первого запроса: его потратил первичный путь
      deadlineMs: NOW_MS - 1,
    });

    const res = await findGmTransfers(ARGS, deps);

    expect(client.request).not.toHaveBeenCalled();
    expect(res.status).toBe("partial");
    expect(res.reason).toBe("deadline");
    expect(res.window!.fromBlock).toBeLessThanOrEqual(res.window!.toBlock);
    expect(res.window!.fromBlock).toBe(Number(LATEST_BLOCK));
    expect(res.window!.fromIso).toBe(res.window!.toIso);
  });

  it("голова цепочки не читается — окна нет вовсе", async () => {
    const { deps, client } = makeDeps();
    client.getBlock.mockResolvedValue({ number: null, timestamp: NOW_SEC });

    const res = await findGmTransfers(ARGS, deps);

    expect(res.status).toBe("unavailable");
    expect(res.reason).toBe("no_window");
    expect(res.window).toBeNull();
    expect(res.source).toBe("none");
  });
});

// --- Бюджет ---

describe("findGmTransfers: бюджет времени", () => {
  it("времени на цены не осталось — строки приходят без цены, а не теряются", async () => {
    const { deps, fetchRange } = makeDeps({ deadlineMs: NOW_MS + 1_500 });
    deps.fetchFn = vi.fn(async () =>
      alchemyBody([mintTransfer()]),
    ) as unknown as typeof fetch;

    const res = await findGmTransfers(ARGS, deps);

    // CoinGecko при 429 спит пятнадцать секунд и повторяет запрос: успеть
    // спросить цену здесь нельзя, а количество GM известно и без неё
    expect(fetchRange).not.toHaveBeenCalled();
    expect(res.status).toBe("found");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].gmAmount).toBe("1.000000000000000001");
    expect(res.rows[0].assetPriceUsd).toBeNull();
    expect(res.rows[0].priceAtIso).toBeNull();
    // «Цены нет, потому что не успели» отличимо от «id актива не знаем»
    expect(res.assetCoingeckoId).toBe("ethereum");
  });

  it("времени достаточно — цена запрашивается (контроль к предыдущему тесту)", async () => {
    const { deps, fetchRange } = makeDeps({ deadlineMs: NOW_MS + 22_000 });
    deps.fetchFn = vi.fn(async () =>
      alchemyBody([mintTransfer()]),
    ) as unknown as typeof fetch;

    const res = await findGmTransfers(ARGS, deps);

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(res.rows[0].assetPriceUsd).toBe(2_345.67);
  });

  it("id актива неизвестен — CoinGecko не спрашивается вовсе", async () => {
    const { deps, fetchRange } = makeDeps();
    deps.fetchFn = vi.fn(async () =>
      alchemyBody([mintTransfer()]),
    ) as unknown as typeof fetch;

    const res = await findGmTransfers(
      { ...ARGS, longSymbol: "НЕИЗВЕСТНО", coingeckoId: null },
      deps,
    );

    expect(fetchRange).not.toHaveBeenCalled();
    expect(res.assetCoingeckoId).toBeNull();
    expect(res.rows[0].assetPriceUsd).toBeNull();
    // Количество GM — обязательная величина по S8.1 — на месте
    expect(res.rows[0].gmAmount).toBe("1.000000000000000001");
  });

  it("CoinGecko отказал — строки остаются, цены нет", async () => {
    const { deps } = makeDeps({
      cg: {
        fetchRange: vi.fn(async () => {
          throw new Error("CoinGecko: HTTP 429");
        }),
      },
    });
    deps.fetchFn = vi.fn(async () =>
      alchemyBody([mintTransfer()]),
    ) as unknown as typeof fetch;

    const res = await findGmTransfers(ARGS, deps);

    expect(res.status).toBe("found");
    expect(res.rows[0].assetPriceUsd).toBeNull();
  });

  it("CoinGecko молчит — ждём не дольше остатка бюджета и отдаём строки без цены", async () => {
    const { deps } = makeDeps({
      deadlineMs: NOW_MS + 2_050,
      cg: { fetchRange: vi.fn(() => new Promise<never>(() => {})) },
    });
    deps.fetchFn = vi.fn(async () =>
      alchemyBody([mintTransfer()]),
    ) as unknown as typeof fetch;

    const res = await findGmTransfers(ARGS, deps);

    expect(res.status).toBe("found");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].assetPriceUsd).toBeNull();
  });

  it("зависший Alchemy обрывается по своей доле бюджета и уводит на eth_getLogs", async () => {
    const started = Date.now();
    const { deps, client } = makeDeps({ deadlineMs: NOW_MS + 2_100 });
    const fetchFn = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason ?? new Error("aborted")),
          );
        }),
    );
    deps.fetchFn = fetchFn as unknown as typeof fetch;
    client.request.mockResolvedValueOnce([burnLog()]);

    const res = await findGmTransfers(ARGS, deps);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    // Половина остатка бюджета, а не весь остаток: запасному пути тоже нужно время
    expect(Date.now() - started).toBeLessThan(2_100);
    expect(res.source).toBe("logs");
    expect(res.status).toBe("found");
    expect(res.rows).toHaveLength(1);
  });

  it("остатка не хватает даже на Alchemy — сразу к узлу, без лишнего запроса", async () => {
    // Полсекунды не хватит на два запроса к Alchemy, и потратить их значило бы
    // отнять время у запасного пути, который отвечает быстрее
    const { deps, client } = makeDeps({ deadlineMs: NOW_MS + 500 });
    client.request.mockResolvedValueOnce([burnLog()]);

    const res = await findGmTransfers(ARGS, deps);

    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(client.request).toHaveBeenCalled();
    expect(res.source).toBe("logs");
    expect(res.rows).toHaveLength(1);
  });
});

// --- Контракт «никогда не бросает» ---

describe("findGmTransfers никогда не бросает", () => {
  const breakers: [name: string, deps: () => Partial<GmSearchDeps>][] = [
    [
      "клиент бросает синхронно",
      () => ({
        client: {
          getBlock: () => {
            throw new Error("клиент не собран");
          },
          request: async () => [],
        } as unknown as GmSearchRpcClient,
      }),
    ],
    [
      "клиент бросает асинхронно",
      () => ({
        client: {
          getBlock: async () => {
            throw new Error("RPC down");
          },
          request: async () => [],
        } as unknown as GmSearchRpcClient,
      }),
    ],
    [
      "узел отдаёт мусор вместо блока",
      () => ({
        client: {
          getBlock: async () => ({ number: "не число", timestamp: null }),
          request: async () => [],
        } as unknown as GmSearchRpcClient,
      }),
    ],
    [
      "eth_getLogs бросает синхронно",
      () => ({
        alchemyUrl: null,
        client: {
          ...makeClient(),
          request: () => {
            throw new Error("транспорт не поднялся");
          },
        } as unknown as GmSearchRpcClient,
      }),
    ],
    [
      "eth_getLogs отдаёт мусор",
      () => ({
        alchemyUrl: null,
        client: { ...makeClient(), request: async () => "не массив" } as unknown as GmSearchRpcClient,
      }),
    ],
    [
      "Alchemy отдаёт нечитаемый JSON",
      () => ({
        fetchFn: vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("Unexpected token < in JSON");
          },
        })) as unknown as typeof fetch,
      }),
    ],
  ];

  for (const [name, override] of breakers) {
    it(`${name}: возвращается ответ, а не исключение`, async () => {
      const { deps } = makeDeps(override());
      const res = await findGmTransfers(ARGS, deps);

      expect(["unavailable", "empty", "partial", "unsupported", "found"]).toContain(
        res.status,
      );
      expect(res.searchDays).toBe(GM_SEARCH_DAYS);
      expect(Array.isArray(res.rows)).toBe(true);
      // Окно либо неизвестно, либо не перевёрнуто
      if (res.window !== null) {
        expect(res.window.fromBlock).toBeLessThanOrEqual(res.window.toBlock);
      }
    });
  }

  it("нет ни ключа, ни узла — «спросить не смогли» с причиной no_provider", async () => {
    const { deps } = makeDeps({
      alchemyUrl: null,
      client: {
        getBlock: async () => {
          throw new Error("RPC down");
        },
        request: async () => [],
      } as unknown as GmSearchRpcClient,
    });

    const res = await findGmTransfers(ARGS, deps);

    expect(res.status).toBe("unavailable");
    expect(res.reason).toBe("no_provider");
    expect(res.window).toBeNull();
    expect(res.assetSymbol).toBe("ETH");
  });
});
