/**
 * Поиск блока по времени — чистая арифметика плюс несколько проб RPC.
 *
 * Нужен там, где состояние читается «как было сутки назад»: аккумуляторы
 * комиссий Uniswap, например. Сеть отвечает на номер блока, а вопрос ставится
 * во времени, и переводить одно в другое приходится самим — готового
 * eth_getBlockByTimestamp в JSON-RPC нет.
 *
 * Среднее время блока НЕ задается таблицей по сетям. Base и Optimism идут
 * к субсекундным блокам, и захардкоженная константа однажды начнет тихо
 * возвращать блок двенадцатичасовой давности: ничего не сломается, цифра
 * просто уполовинится. Поэтому время блока измеряется на месте двумя пробами.
 */

/** Блок и его время — все, что нужно для интерполяции. */
export interface BlockSample {
  block: bigint;
  /** Unix-время в секундах, как отдает узел. */
  timestamp: bigint;
}

export interface BlockWindow {
  /** Блок, ближайший к запрошенному моменту. */
  from: BlockSample;
  /** Голова цепочки на момент запроса — вторая граница окна. */
  latest: BlockSample;
}

/** Узкий интерфейс вместо PublicClient: так функция мокается в тестах. */
export interface BlockRpcClient {
  getBlock(args?: {
    blockNumber?: bigint;
  }): Promise<{ number: bigint | null; timestamp: bigint }>;
}

/** Отступ первой пробы. Не привязан к сети: время блока из нее и берется. */
const PROBE_SPAN = 5_000n;

/**
 * Потолок проб, включая чтение головы цепочки.
 *
 * Ограничение жесткое: без него деградировавший RPC подвесил бы весь
 * POST /api/refresh. Не сошлись за четыре пробы — берем лучшее из
 * полученного, оно все равно на порядки точнее нужного.
 */
export const MAX_BLOCK_PROBES = 4;

/**
 * Допуск. На окне в сутки 120 секунд — это 0,14%.
 *
 * Промах во времени НЕ компенсируется растягиванием результата до ровных
 * суток: это была бы выдуманная величина. Возвращаются фактические границы,
 * а насколько окно отличается от 24 часов — видно по ним же.
 */
export const BLOCK_TOLERANCE_SEC = 120n;

/**
 * Секущая через две пробы, вычисленная в запрошенном моменте.
 *
 * Делитель проверяется не для красоты: на Arbitrum четыре блока в секунду,
 * и у соседних блоков время совпадает буквально. Неглядя поделив, получаем
 * деление на ноль вместо номера блока.
 */
export function interpolateBlock(
  anchor: BlockSample,
  other: BlockSample,
  targetSec: bigint,
  maxBlock: bigint,
): bigint | null {
  const dt = anchor.timestamp - other.timestamp;
  const db = anchor.block - other.block;
  if (dt === 0n || db === 0n) return null;

  const guess = other.block + ((targetSec - other.timestamp) * db) / dt;
  if (guess < 0n) return 0n;
  return guess > maxBlock ? maxBlock : guess;
}

/**
 * Обратное к interpolateBlock: время блока по той же секущей.
 *
 * Нужно там, где номер блока известен (лог трансфера), а спросить у узла
 * заголовок каждого блока слишком дорого или уже не осталось бюджета.
 * Те же два делителя проверяются по той же причине: на Arbitrum время
 * соседних блоков совпадает буквально.
 */
export function timestampFromSamples(
  a: BlockSample,
  b: BlockSample,
  block: bigint,
): bigint | null {
  const dt = a.timestamp - b.timestamp;
  const db = a.block - b.block;
  if (dt === 0n || db === 0n) return null;

  return b.timestamp + ((block - b.block) * dt) / db;
}

/**
 * Потолок точных чтений времени блока за один заход.
 *
 * Совпадает с порядком величины GM_ROW_LIMIT не случайно: время нужно только
 * тем строкам, которые попадут на экран, и читать его следует ПОСЛЕ обрезки
 * списка. Без потолка удачный скан на тысячу трансферов превратился бы
 * в тысячу запросов заголовков.
 */
export const MAX_TIMESTAMP_READS = 12;

/** Время блока: `exact: false` = получено интерполяцией, а не у узла. */
export interface BlockTime {
  sec: bigint;
  exact: boolean;
}

/**
 * Время указанных блоков. Ключ — `block.toString()`.
 *
 * Точные значения читаются у узла (Promise.all, не батч в транспорте:
 * включить батчинг здесь значило бы поменять транспорт всем читателям
 * приложения ради одной функции). Сверх бюджета MAX_TIMESTAMP_READS и при
 * любой ошибке чтения — интерполяция по двум уже известным пробам и
 * `exact: false`, чтобы экран мог сказать «время приблизительное», а не
 * выдать выдуманную минуту за факт.
 *
 * Блок, которому не хватило и интерполяции (пробы вырождены), в результат
 * не попадает: отсутствие ключа — честное «время неизвестно».
 */
export async function blockTimestamps(
  client: BlockRpcClient,
  blocks: readonly bigint[],
  samples: BlockWindow,
): Promise<Map<string, BlockTime>> {
  const out = new Map<string, BlockTime>();
  const unique = [...new Set(blocks.map((b) => b.toString()))].map(BigInt);

  const exactly = unique.slice(0, MAX_TIMESTAMP_READS);
  const guessed = unique.slice(MAX_TIMESTAMP_READS);

  const read = await Promise.all(
    exactly.map(async (block) => {
      try {
        const b = await client.getBlock({ blockNumber: block });
        return { block, sec: b.timestamp };
      } catch {
        // Узел не отдал заголовок — не повод терять строку целиком
        return { block, sec: null };
      }
    }),
  );

  const approximate = (block: bigint) => {
    const sec = timestampFromSamples(samples.latest, samples.from, block);
    if (sec !== null) out.set(block.toString(), { sec, exact: false });
  };

  for (const { block, sec } of read) {
    if (sec === null) approximate(block);
    else out.set(block.toString(), { sec, exact: true });
  }
  for (const block of guessed) approximate(block);

  return out;
}

function distance(sample: BlockSample, targetSec: bigint): bigint {
  const d = sample.timestamp - targetSec;
  return d < 0n ? -d : d;
}

/**
 * Блок, ближайший к моменту targetSec, и голова цепочки одним заходом.
 *
 * Голова возвращается нарочно: она читается первой пробой все равно, а
 * вызывающему нужны обе границы окна — и обе должны быть пинованы по номеру
 * блока, иначе «сейчас» разъедется между запросами.
 *
 * null = не удалось прочитать. Заголовки блоков отдают и узлы без архива,
 * так что этот шаг переживает отсутствие архивного провайдера: отказ будет
 * честным «окно знаем, состояние не прочитали», а не «непонятно, что
 * спрашивать».
 */
export async function blockAtTimestamp(
  client: BlockRpcClient,
  targetSec: bigint,
): Promise<BlockWindow | null> {
  let probes = 0;
  const read = async (blockNumber?: bigint): Promise<BlockSample | null> => {
    probes += 1;
    const b = await client.getBlock(
      blockNumber === undefined ? undefined : { blockNumber },
    );
    // number === null бывает только у pending-блока, который мы не просим
    return b.number === null ? null : { block: b.number, timestamp: b.timestamp };
  };

  const latest = await read();
  if (latest === null) return null;

  // Момент в будущем или голова цепочки старше него — окна нет
  if (targetSec >= latest.timestamp) return { from: latest, latest };

  const first = latest.block > PROBE_SPAN ? latest.block - PROBE_SPAN : 0n;
  const seeded = await read(first);
  if (seeded === null) return null;

  let best =
    distance(seeded, targetSec) <= distance(latest, targetSec) ? seeded : latest;
  // Вторая точка секущей, всегда отличная от best
  let anchor = best === seeded ? latest : seeded;
  const visited = new Set<bigint>([latest.block, seeded.block]);

  while (
    probes < MAX_BLOCK_PROBES &&
    distance(best, targetSec) > BLOCK_TOLERANCE_SEC
  ) {
    // Запасная секущая — через голову цепочки: у нее время заведомо отличается
    // от любой пробы, даже когда у соседних блоков оно совпало
    const guess =
      interpolateBlock(anchor, best, targetSec, latest.block) ??
      interpolateBlock(latest, best, targetSec, latest.block);
    // Некуда двигаться: время проб совпало или секущая привела туда же
    if (guess === null || visited.has(guess)) break;
    visited.add(guess);

    const sample = await read(guess);
    if (sample === null) break;
    if (distance(sample, targetSec) < distance(best, targetSec)) {
      anchor = best;
      best = sample;
    } else {
      anchor = sample;
    }
  }

  return { from: best, latest };
}
