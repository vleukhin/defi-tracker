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
