import { describe, expect, it } from "vitest";
import {
  GM_ROW_LIMIT,
  MAX_LOG_REQUESTS,
  MAX_LOG_SPAN,
  MIN_LOG_SPAN,
  TRANSFER_TOPIC,
  ZERO_ADDRESS,
  ZERO_TOPIC,
  addressTopic,
  assembleRows,
  assetTransfersParams,
  classifyNodeError,
  classifyTransfer,
  initialLogSpan,
  logRangeHint,
  logWindowOf,
  logsFilter,
  nextLogWindow,
  pickPriceAt,
  priceRangeFor,
  searchWindowSec,
  type GmTransferRaw,
  type LogScanDone,
  type LogScanOutcome,
  type LogScanState,
} from "./gm-transfers";

/**
 * Чистое ядро поиска операций с GM (Фаза 8, S8.5).
 *
 * Проверяется здесь ровно то, ради чего ядро отделено от сети: что считать
 * покупкой, как подбирать окно запроса, как читать жалобу узла и какой
 * диапазон цен просить у CoinGecko. Ни одного мока сети в файле нет — сеть
 * живёт в gm-search.ts и проверяется отдельно.
 */

const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const gmToken = "0x47c031236e19d024b42f8AE6780E44A573170703";

const DAY_SEC = 86_400n;

// --- Классификация трансфера ---

describe("classifyTransfer", () => {
  it("mint кошельку — покупка, burn с кошелька — продажа", () => {
    expect(classifyTransfer({ from: ZERO_ADDRESS, to: wallet, wallet })).toBe("buy");
    expect(classifyTransfer({ from: wallet, to: ZERO_ADDRESS, wallet })).toBe("sell");
  });

  it("перевод кошелёк → кошелёк отбрасывается: количество GM от него не меняется", () => {
    expect(classifyTransfer({ from: wallet, to: other, wallet })).toBeNull();
    expect(classifyTransfer({ from: other, to: wallet, wallet })).toBeNull();
    expect(classifyTransfer({ from: wallet, to: wallet, wallet })).toBeNull();
  });

  it("mint не нам и burn не с нашего кошелька — не наши операции", () => {
    expect(classifyTransfer({ from: ZERO_ADDRESS, to: other, wallet })).toBeNull();
    expect(classifyTransfer({ from: other, to: ZERO_ADDRESS, wallet })).toBeNull();
  });

  it("0x0 → 0x0 не считается ни покупкой, ни продажей", () => {
    expect(
      classifyTransfer({ from: ZERO_ADDRESS, to: ZERO_ADDRESS, wallet }),
    ).toBeNull();
  });

  it("регистр адреса не влияет: узлы отдают checksum, Alchemy — lowercase", () => {
    expect(
      classifyTransfer({
        from: ZERO_ADDRESS,
        to: "0x1111111111111111111111111111111111111111".toUpperCase().replace("0X", "0x"),
        wallet,
      }),
    ).toBe("buy");
  });
});

// --- Параметры запросов ---

describe("параметры запросов", () => {
  it("topic0 — канонический keccak ERC-20 Transfer", () => {
    // Опечатка здесь не сломала бы сборку: узел молча вернул бы ноль логов
    expect(TRANSFER_TOPIC).toBe(
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    );
  });

  it("addressTopic дополняет адрес слева нулями до 32 байт", () => {
    const topic = addressTopic("0xAbCdEf0123456789012345678901234567890123");
    expect(topic).toBe(
      "0x000000000000000000000000abcdef0123456789012345678901234567890123",
    );
    expect(topic).toHaveLength(66);
    expect(ZERO_TOPIC).toHaveLength(66);
  });

  it("logsFilter спрашивает mint и burn одним фильтром", () => {
    const filter = logsFilter({
      gmToken,
      wallet,
      fromBlock: 100n,
      toBlock: 200n,
    });
    expect(filter.address).toBe(gmToken.toLowerCase());
    expect(filter.topics).toEqual([
      TRANSFER_TOPIC,
      [ZERO_TOPIC, addressTopic(wallet)],
      [ZERO_TOPIC, addressTopic(wallet)],
    ]);
    // Блоки — hex, а не десятичные: узел на десятичных ответит ошибкой
    expect(filter.fromBlock).toBe("0x64");
    expect(filter.toBlock).toBe("0xc8");
  });

  it("assetTransfersParams фильтрует по стороне кошелька, а не по нулевому адресу", () => {
    const query = { gmToken, wallet, fromBlock: 1n, toBlock: 4_000_000n };
    const incoming = assetTransfersParams(query, "in");
    const outgoing = assetTransfersParams(query, "out");

    expect(incoming.toAddress).toBe(wallet.toLowerCase());
    expect(incoming.fromAddress).toBeUndefined();
    expect(outgoing.fromAddress).toBe(wallet.toLowerCase());
    expect(outgoing.toAddress).toBeUndefined();

    // Нулевого адреса в фильтре нет — классификация одинакова для обоих путей
    expect(JSON.stringify(incoming)).not.toContain(ZERO_ADDRESS);
    expect(JSON.stringify(outgoing)).not.toContain(ZERO_ADDRESS);

    // withMetadata несёт время блока: без него пришлось бы читать заголовки
    expect(incoming.withMetadata).toBe(true);
    expect(incoming.order).toBe("desc");
    expect(incoming.category).toEqual(["erc20"]);
    expect(incoming.contractAddresses).toEqual([gmToken.toLowerCase()]);
    expect(incoming.fromBlock).toBe("0x1");
    expect(incoming.toBlock).toBe("0x3d0900");
  });
});

// --- Размер первого окна ---

describe("initialLogSpan", () => {
  const window = (dBlocks: bigint, dSecs: bigint) => ({
    from: { block: 1_000n, timestamp: 1_700_000_000n },
    latest: { block: 1_000n + dBlocks, timestamp: 1_700_000_000n + dSecs },
  });

  it("окно выводится из ИЗМЕРЕННОГО времени блока, а не из таблицы сетей", () => {
    // Arbitrum: 4 блока в секунду -> сутки это 345 600 блоков
    const arbitrum = initialLogSpan(window(14_400n, 3_600n));
    // Ethereum: 12 секунд на блок -> сутки это 7 200 блоков
    const ethereum = initialLogSpan(window(300n, 3_600n));

    expect(arbitrum).toBe(345_600n);
    expect(ethereum).toBe(7_200n);
    // Ровно ради этого окно и меряется: константа, разумная для Ethereum,
    // покрыла бы на Arbitrum сорок минут вместо суток
    expect(arbitrum / ethereum).toBeGreaterThanOrEqual(10n);
  });

  it("вырожденные пробы дают пол, а не деление на ноль", () => {
    // Совпало время (соседние блоки Arbitrum), совпал блок, проба «назад»
    expect(initialLogSpan(window(14_400n, 0n))).toBe(MIN_LOG_SPAN);
    expect(initialLogSpan(window(0n, 3_600n))).toBe(MIN_LOG_SPAN);
    expect(initialLogSpan(window(-100n, 3_600n))).toBe(MIN_LOG_SPAN);
    expect(initialLogSpan(window(14_400n, -3_600n))).toBe(MIN_LOG_SPAN);
  });

  it("субсекундная цепочка упирается в потолок, а не просит миллионы блоков", () => {
    expect(initialLogSpan(window(3_600_000n, 3_600n))).toBe(MAX_LOG_SPAN);
  });

  it("медленная цепочка упирается в пол", () => {
    // Один блок в час: сутки это 24 блока, но спрашивать окнами по 24 блока
    // бессмысленно — узел прекрасно ответит на тысячу
    expect(initialLogSpan(window(1n, 3_600n))).toBe(MIN_LOG_SPAN);
  });
});

// --- Подбор окна ---

interface Range {
  fromBlock: bigint;
  toBlock: bigint;
}

/**
 * Прогон скана целиком: `reply` играет роль узла.
 *
 * Тайлинг проверяется по накопленным окнам, а не по одному шагу: разрыв
 * между окнами теряет операции молча, а перекрытие удваивает запросы.
 */
function drive(
  state: LogScanState,
  reply: (range: Range, step: number) => LogScanOutcome,
): {
  ranges: Range[];
  done: LogScanDone;
  reachedBlock: bigint;
  requests: number;
} {
  let current = state;
  let range = logWindowOf(current);
  const ranges: Range[] = [range];

  for (let i = 0; i < 500; i += 1) {
    const step = nextLogWindow(current, reply(range, i));
    if ("done" in step) {
      return {
        ranges,
        done: step.done,
        reachedBlock: step.reachedBlock,
        requests: i + 1,
      };
    }
    current = step.state;
    range = step.range;
    ranges.push(range);
  }
  throw new Error("скан не завершился за 500 шагов");
}

const NEVER = Number.MAX_SAFE_INTEGER;
const ok = (nowMs = 0): LogScanOutcome => ({ kind: "ok", nowMs });

describe("logWindowOf", () => {
  it("нижняя граница не уходит под пол поиска", () => {
    const state: LogScanState = {
      cursor: 1_000n,
      floor: 800n,
      span: 5_000n,
      requests: 0,
      deadlineMs: NEVER,
    };
    expect(logWindowOf(state)).toEqual({ fromBlock: 800n, toBlock: 1_000n });
  });

  it("окно ровно на span блоков, когда пол далеко", () => {
    const state: LogScanState = {
      cursor: 1_000n,
      floor: 0n,
      span: 100n,
      requests: 0,
      deadlineMs: NEVER,
    };
    expect(logWindowOf(state)).toEqual({ fromBlock: 901n, toBlock: 1_000n });
  });
});

describe("nextLogWindow: тайлинг", () => {
  const latest = 400_000_000n;
  // 14 суток Arbitrum ~ 4,84 млн блоков
  const floor = latest - 4_838_400n;
  const start: LogScanState = {
    cursor: latest,
    floor,
    span: 345_600n,
    requests: 0,
    deadlineMs: NEVER,
  };

  const scan = () => drive(start, () => ok());

  it("окна покрывают диапазон без разрывов и без перекрытий", () => {
    const { ranges, done, reachedBlock } = scan();

    expect(done).toBe<LogScanDone>("reached");
    expect(reachedBlock).toBe(floor);
    expect(ranges[0].toBlock).toBe(latest);
    expect(ranges[ranges.length - 1].fromBlock).toBe(floor);

    for (let i = 1; i < ranges.length; i += 1) {
      // Стык впритык: нижняя граница прошлого окна минус один
      expect(ranges[i].toBlock).toBe(ranges[i - 1].fromBlock - 1n);
    }

    const covered = ranges.reduce(
      (sum, r) => sum + (r.toBlock - r.fromBlock + 1n),
      0n,
    );
    expect(covered).toBe(latest - floor + 1n);
  });

  it("курсор строго убывает на каждом успехе", () => {
    const { ranges } = scan();
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i].toBlock).toBeLessThan(ranges[i - 1].toBlock);
      expect(ranges[i].fromBlock).toBeLessThan(ranges[i - 1].fromBlock);
    }
  });

  it("окно удваивается на успехе и упирается в потолок", () => {
    const { ranges } = scan();
    const sizes = ranges.map((r) => r.toBlock - r.fromBlock + 1n);
    expect(sizes.slice(0, 3)).toEqual([345_600n, 691_200n, 1_382_400n]);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(MAX_LOG_SPAN);
    expect(sizes).toContain(MAX_LOG_SPAN);
  });

  it("последнее окно обрезано полом, а не перелетает его", () => {
    const { ranges } = scan();
    for (const r of ranges) expect(r.fromBlock).toBeGreaterThanOrEqual(floor);
  });
});

describe("nextLogWindow: остановки", () => {
  const latest = 1_000_000_000_000n;

  it("потолок запросов: partial по бюджету, а не молчание подольше", () => {
    const { done, requests, reachedBlock, ranges } = drive(
      { cursor: latest, floor: 0n, span: MIN_LOG_SPAN, requests: 0, deadlineMs: NEVER },
      () => ok(),
    );
    expect(done).toBe<LogScanDone>("budget");
    expect(requests).toBe(MAX_LOG_REQUESTS);
    // Дошли до низа последнего прочитанного окна, а не до пола поиска
    expect(reachedBlock).toBe(ranges[ranges.length - 1].fromBlock);
    expect(reachedBlock).toBeGreaterThan(0n);
  });

  it("срок: скан обрывается на первом же ответе после дедлайна", () => {
    const { done, requests, reachedBlock, ranges } = drive(
      { cursor: latest, floor: 0n, span: 10_000n, requests: 0, deadlineMs: 1_000 },
      (_range, step) => ok(step < 3 ? 0 : 5_000),
    );
    expect(done).toBe<LogScanDone>("deadline");
    expect(requests).toBe(4);
    expect(ranges).toHaveLength(4);
    expect(reachedBlock).toBe(ranges[3].fromBlock);
  });

  it("сжатие ниже пола окна — «провайдер не умеет», а не «операций нет»", () => {
    const { done, requests, reachedBlock } = drive(
      { cursor: latest, floor: 0n, span: 4_000n, requests: 0, deadlineMs: NEVER },
      () => ({ kind: "tooMany", message: "query returned more than 10000 results", nowMs: 0 }),
    );
    // 4000 -> 2000 -> 1000 -> 500 < MIN_LOG_SPAN
    expect(requests).toBe(3);
    expect(done).toBe<LogScanDone>("unsupported");
    // Курсор не двигался: не прочитано ни одного блока
    expect(reachedBlock).toBe(latest + 1n);
  });

  it("на отказе курсор стоит: непрочитанный кусок истории не объявляется прочитанным", () => {
    const { ranges } = drive(
      { cursor: latest, floor: 0n, span: 8_000n, requests: 0, deadlineMs: NEVER },
      () => ({ kind: "timeout", message: "query timed out", nowMs: 0 }),
    );
    for (const r of ranges) expect(r.toBlock).toBe(latest);
    expect(ranges.map((r) => r.toBlock - r.fromBlock + 1n)).toEqual([
      8_000n,
      4_000n,
      2_000n,
      1_000n,
    ]);
  });
});

describe("жалобы узлов", () => {
  /** Настоящие тексты ответов провайдеров, а не выдуманные. */
  const tooMany = [
    "Log response size exceeded. this block range should work: [0x1a2b, 0x1a99]",
    "You can make eth_getLogs requests with up to a 2K block range and no limit on the response size",
    "query returned more than 10000 results",
    "block range is too wide",
    "eth_getLogs is limited to a 10,000 blocks range",
    "requested too many blocks from 0 to 5000000, maximum is set to 1024",
    "Query timeout limit exceeded",
  ];
  const timeouts = [
    "query timed out",
    "Request timeout",
    "context deadline exceeded",
  ];
  const unknown = [
    "execution reverted",
    "missing trie node 0xabc (path )",
    "insufficient funds for gas * price + value",
    "method eth_getLogs does not exist/is not available",
  ];

  for (const message of tooMany) {
    it(`«${message.slice(0, 40)}…» — слишком широкий диапазон`, () => {
      expect(classifyNodeError(message)).toBe("tooMany");
    });
  }

  for (const message of timeouts) {
    it(`«${message}» — таймаут`, () => {
      expect(classifyNodeError(message)).toBe("timeout");
    });
  }

  for (const message of unknown) {
    it(`«${message.slice(0, 40)}…» — незнакомая ошибка, гадать нельзя`, () => {
      expect(classifyNodeError(message)).toBeNull();
    });
  }
});

describe("logRangeHint", () => {
  it("подсказка Alchemy разбирается как размер диапазона", () => {
    expect(
      logRangeHint(
        "Log response size exceeded. this block range should work: [0x1a2b, 0x1a99]",
      ),
      // 0x1a99 - 0x1a2b + 1: границы включительные
    ).toBe(111n);
  });

  it("сообщение без подсказки — null, делим пополам сами", () => {
    expect(logRangeHint("query returned more than 10000 results")).toBeNull();
    expect(logRangeHint("block range is too wide")).toBeNull();
  });

  it("перевёрнутая подсказка отбрасывается, а не даёт отрицательное окно", () => {
    expect(logRangeHint("should work: [0x1a99, 0x1a2b]")).toBeNull();
  });

  it("подсказка применяется ДОСЛОВНО, а не как «поделить пополам»", () => {
    const latest = 1_000_000n;
    const step = nextLogWindow(
      { cursor: latest, floor: 0n, span: 500_000n, requests: 0, deadlineMs: NEVER },
      {
        kind: "tooMany",
        message: "Log response size exceeded. this block range should work: [0x0, 0x2710]",
        nowMs: 0,
      },
    );
    expect("state" in step).toBe(true);
    if (!("state" in step)) return;
    // 0x2710 + 1 = 10001, а половина от 500 000 была бы 250 000
    expect(step.state.span).toBe(10_001n);
    expect(step.range).toEqual({ fromBlock: 990_000n, toBlock: latest });
  });

  it("подсказка ШИРЕ текущего окна тоже применяется дословно", () => {
    const step = nextLogWindow(
      { cursor: 1_000_000n, floor: 0n, span: 2_000n, requests: 0, deadlineMs: NEVER },
      {
        kind: "tooMany",
        message: "this block range should work: [0x0, 0xc350]",
        nowMs: 0,
      },
    );
    expect("state" in step && step.state.span).toBe(50_001n);
  });

  it("подсказка ниже пола окна означает «провайдер не потянет 14 суток»", () => {
    // 111 блоков на запрос — это 2 664 блока за весь бюджет из 24 запросов,
    // то есть одиннадцать минут Arbitrum вместо двух недель. Честный ответ —
    // «не поддерживает», а не «операций не найдено»
    const step = nextLogWindow(
      { cursor: 1_000_000n, floor: 0n, span: 200_000n, requests: 0, deadlineMs: NEVER },
      {
        kind: "tooMany",
        message: "Log response size exceeded. this block range should work: [0x1a2b, 0x1a99]",
        nowMs: 0,
      },
    );
    expect(step).toEqual({ done: "unsupported", reachedBlock: 1_000_001n });
  });
});

// --- Сборка строк ---

function raw(over: Partial<GmTransferRaw> = {}): GmTransferRaw {
  return {
    txHash: `0x${"a".repeat(64)}`,
    logIndex: 0,
    blockNumber: 100n,
    from: ZERO_ADDRESS,
    to: wallet,
    raw: 10n ** 18n,
    ...over,
  };
}

const tx = (n: number) => `0x${String(n).padStart(64, "0")}`;

describe("assembleRows", () => {
  it("продажа и покупка В ОДНОЙ транзакции обе доходят до экрана", () => {
    // Базовый сценарий §5: на уровне GM продаются и тут же откупаются.
    // Дедупликация по транзакции склеила бы их в одну строку
    const rows = assembleRows(
      [
        raw({ txHash: tx(7), logIndex: 3, from: wallet, to: ZERO_ADDRESS, raw: 5n * 10n ** 18n }),
        raw({ txHash: tx(7), logIndex: 9, from: ZERO_ADDRESS, to: wallet, raw: 4n * 10n ** 18n }),
      ],
      wallet,
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.kind)).toEqual(["buy", "sell"]);
    expect(rows.map((r) => r.gmAmount)).toEqual(["4", "5"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("сортировка по (блок, logIndex) убыванием — свежее первым", () => {
    const rows = assembleRows(
      [
        raw({ txHash: tx(1), logIndex: 1, blockNumber: 100n }),
        raw({ txHash: tx(2), logIndex: 9, blockNumber: 100n }),
        raw({ txHash: tx(3), logIndex: 5, blockNumber: 100n }),
        raw({ txHash: tx(4), logIndex: 0, blockNumber: 200n }),
      ],
      wallet,
    );

    expect(rows.map((r) => [Number(r.blockNumber), r.logIndex])).toEqual([
      [200, 0],
      [100, 9],
      [100, 5],
      [100, 1],
    ]);
  });

  it("дедупликация по (txHash, logIndex): один лог — одна строка, даже с разным регистром хеша", () => {
    const rows = assembleRows(
      [
        raw({ txHash: tx(1), logIndex: 4, raw: 7n * 10n ** 18n }),
        // Тот же лог из второго источника (Alchemy «пришло» и eth_getLogs)
        raw({ txHash: tx(1), logIndex: 4, raw: 7n * 10n ** 18n }),
        raw({ txHash: tx(1).toUpperCase().replace("0X", "0x"), logIndex: 4, raw: 7n * 10n ** 18n }),
        raw({ txHash: tx(2), logIndex: 4 }),
      ],
      wallet,
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.key)).toEqual([`${tx(1)}:4`, `${tx(2)}:4`]);
    // Ключ хранится в нижнем регистре: иначе тот же лог из двух источников
    // с разным регистром хеша дал бы две строки
    expect(rows.every((r) => r.txHash === r.txHash.toLowerCase())).toBe(true);
  });

  it("из двух копий одного лога выигрывает ПЕРВАЯ, а не последняя", () => {
    // Проверять дедупликацию количеством строк бесполезно: Map схлопывает
    // одинаковые ключи сам. Наблюдаемое следствие проверки `has` ровно одно —
    // какая из копий доживает до экрана. Порядок источников фиксирован
    // (Alchemy «пришло», потом «ушло»), и результат не должен зависеть от того,
    // сколько раз узел повторил один и тот же лог
    const rows = assembleRows(
      [
        raw({ txHash: tx(1), logIndex: 4, raw: 7n * 10n ** 18n }),
        raw({ txHash: tx(1), logIndex: 4, raw: 999n * 10n ** 18n }),
      ],
      wallet,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].gmAmount).toBe("7");
  });

  it("отбрасывает переводы кошелёк → кошелёк вместе с чужими mint", () => {
    const rows = assembleRows(
      [
        raw({ txHash: tx(1), from: wallet, to: other }),
        raw({ txHash: tx(2), from: ZERO_ADDRESS, to: other }),
        raw({ txHash: tx(3) }),
      ],
      wallet,
    );
    expect(rows.map((r) => r.txHash)).toEqual([tx(3)]);
  });

  it("на экран уходит не больше GM_ROW_LIMIT самых свежих строк", () => {
    const rows = assembleRows(
      Array.from({ length: 15 }, (_, i) =>
        raw({ txHash: tx(i), logIndex: i, blockNumber: BigInt(100 + i) }),
      ),
      wallet,
    );

    expect(rows).toHaveLength(GM_ROW_LIMIT);
    expect(rows[0].blockNumber).toBe(114n);
    expect(rows[GM_ROW_LIMIT - 1].blockNumber).toBe(105n);
  });

  it("количество GM — точная десятичная строка, без участия float", () => {
    const rows = assembleRows(
      [
        raw({ txHash: tx(1), raw: 1_000_000_000_000_000_001n }),
        raw({ txHash: tx(2), blockNumber: 99n, raw: 123_456_789_012_345_678_901_234n }),
        raw({ txHash: tx(3), blockNumber: 98n, raw: 1n }),
      ],
      wallet,
    );

    // Через double младшая единица потерялась бы: Number(1e18 + 1) === 1e18
    expect(rows[0].gmAmount).toBe("1.000000000000000001");
    expect(rows[1].gmAmount).toBe("123456.789012345678901234");
    expect(rows[2].gmAmount).toBe("0.000000000000000001");
  });

  it("время берётся из источника, если он его дал, и не выдумывается иначе", () => {
    const rows = assembleRows(
      [
        raw({ txHash: tx(1), timestampSec: 1_700_000_500n }),
        raw({ txHash: tx(2), blockNumber: 99n }),
      ],
      wallet,
    );

    expect(rows[0].happenedAtSec).toBe(1_700_000_500n);
    expect(rows[0].timeApproximate).toBe(false);
    expect(rows[1].happenedAtSec).toBeNull();
  });

  it("пустой вход — пустой список, а не исключение", () => {
    expect(assembleRows([], wallet)).toEqual([]);
  });
});

// --- Цены ---

describe("priceRangeFor", () => {
  const rowsAt = (...secs: bigint[]) =>
    secs.map((happenedAtSec) => ({ happenedAtSec }));
  const width = (range: { fromSec: bigint; toSec: bigint }) =>
    range.toSec - range.fromSec;

  it("набор без времени — спрашивать нечего", () => {
    expect(priceRangeFor([])).toBeNull();
    expect(priceRangeFor([{ happenedAtSec: null }, { happenedAtSec: null }])).toBeNull();
  });

  it("строки без времени не портят границы", () => {
    const range = priceRangeFor([
      { happenedAtSec: null },
      { happenedAtSec: 2_000n },
      { happenedAtSec: 1_000n },
      { happenedAtSec: null },
    ]);
    expect(range).toEqual({ fromSec: 700n, toSec: 2_300n });
  });

  it("набор ровно на границе суток остаётся в пятиминутной сетке CoinGecko", () => {
    // Граница: сутки минус двойной узкий паддинг. Здесь она и проверяется —
    // раньше в коде стояло «сутки минус ЧАС», и наборы размахом 23…23:50 ч
    // молча получали часовую сетку, хотя запрос укладывался в сутки
    const base = 1_700_000_000n;
    const range = priceRangeFor(rowsAt(base, base + 85_800n))!;

    expect(width(range)).toBe(DAY_SEC);
    expect(width(range)).toBeLessThanOrEqual(DAY_SEC);
    expect(range).toEqual({ fromSec: base - 300n, toSec: base + 86_100n });
  });

  it("на секунду шире суток — паддинг расширяется, сетка уже часовая", () => {
    const base = 1_700_000_000n;
    const range = priceRangeFor(rowsAt(base, base + 85_801n))!;

    expect(width(range)).toBe(85_801n + 7_200n);
    expect(width(range)).toBeGreaterThan(DAY_SEC);
    expect(range).toEqual({ fromSec: base - 3_600n, toSec: base + 89_401n });
  });

  it("любой набор внутри границы просит не больше суток", () => {
    const base = 1_700_000_000n;
    for (const spread of [0n, 300n, 3_600n, 82_799n, 82_800n, 85_000n, 85_800n]) {
      const range = priceRangeFor(rowsAt(base, base + spread))!;
      expect(width(range)).toBeLessThanOrEqual(DAY_SEC);
    }
  });

  it("самый частый случай — одна операция сегодня — это узкий паддинг", () => {
    const range = priceRangeFor(rowsAt(1_700_000_000n))!;
    expect(range).toEqual({ fromSec: 1_699_999_700n, toSec: 1_700_000_300n });
  });

  it("две недели — часовой паддинг", () => {
    const base = 1_700_000_000n;
    const range = priceRangeFor(rowsAt(base, base + 14n * DAY_SEC))!;
    expect(range.fromSec).toBe(base - 3_600n);
    expect(range.toSec).toBe(base + 14n * DAY_SEC + 3_600n);
  });
});

describe("pickPriceAt", () => {
  it("берёт ближайшую точку ряда", () => {
    const point = pickPriceAt(
      { points: [[900_000, 10], [1_100_000, 20]], stepSec: 200 },
      1_020n,
    );
    expect(point).toEqual({ priceUsd: 20, atMs: 1_100_000 });
  });

  it("пустой ряд — цены нет, а не ноль", () => {
    expect(pickPriceAt({ points: [], stepSec: null }, 1_000n)).toBeNull();
  });

  it("промах больше допуска — цены нет: подставлять недельную давность нельзя", () => {
    const dayAgoMs = 1_700_000_000_000 - 86_400_000;
    expect(
      pickPriceAt({ points: [[dayAgoMs, 42]], stepSec: 300 }, 1_700_000_000n),
    ).toBeNull();
  });

  it("допуск не опускается ниже двух часов даже на пятиминутном ряде", () => {
    const targetSec = 1_700_000_000n;
    const withinMs = Number(targetSec) * 1000 - 7_000_000;
    const beyondMs = Number(targetSec) * 1000 - 7_300_000;

    expect(pickPriceAt({ points: [[withinMs, 42]], stepSec: 300 }, targetSec)?.priceUsd).toBe(42);
    expect(pickPriceAt({ points: [[beyondMs, 42]], stepSec: 300 }, targetSec)).toBeNull();
  });

  it("шаг ряда неизвестен — допуск считается от часа", () => {
    const targetSec = 1_700_000_000n;
    const ms = Number(targetSec) * 1000 - 7_000_000;
    expect(pickPriceAt({ points: [[ms, 7]], stepSec: null }, targetSec)?.priceUsd).toBe(7);
  });
});

describe("searchWindowSec", () => {
  it("окно поиска строго равно четырнадцати суткам", () => {
    const window = searchWindowSec(2_000_000n);
    expect(window.toSec - window.fromSec).toBe(14n * DAY_SEC);
    expect(window.toSec).toBe(2_000_000n);
  });
});
