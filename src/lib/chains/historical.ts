import "server-only";
import type { Address } from "viem";
import { archiveClient, CHAIN_IDS, type ChainId } from "./config";
import { blockAtTimestamp, type BlockRpcClient } from "./blocks";

/**
 * Чтение состояния сетей «как было в прошлом»: клиент, прибитый к блоку.
 *
 * Зачем. Снепшот — это измерение, и пропущенный день восстанавливается
 * ровно одним честным способом: перечитать те же контракты на блоке той
 * даты. Всё остальное (реплей журнала, перенос вчерашнего состава) — не
 * измерение, а модель, и выдавать её за точку истории нельзя.
 *
 * Почему не параметр у каждого ридера. Ридеров шесть, у каждого свой
 * «узкий интерфейс клиента» (для моков в тестах) и своя цепочка вызовов до
 * multicall. Протаскивать номер блока через все — шесть сигнатур, которые
 * обязаны не разъехаться. Но раз клиент УЖЕ инъектируется (opts.clients),
 * прибить блок можно в нём: ридеры остаются нетронутыми, а «когда» живёт
 * одним решением в одном месте.
 *
 * Правило подмены: blockNumber ставится, только если вызывающий не указал
 * свой. Uniswap читает аккумуляторы комиссий на двух конкретных блоках, и
 * перебить их общим пином значило бы сравнить блок сам с собой.
 */

/** Блок, выбранный под запрошенный момент, и насколько он в него не попал. */
export interface PinnedBlock {
  block: bigint;
  /** Время блока по узлу, Unix-секунды. */
  timestamp: bigint;
  /** Промах времени блока относительно запрошенного момента, секунды. */
  driftSec: number;
}

/**
 * Проб больше, чем у живого пути: вызов идёт из скрипта, лишний round-trip
 * ничего не стоит, а промах в блоке сдвигает всю точку истории.
 */
export const HISTORICAL_BLOCK_PROBES = 8;

/**
 * Клиент сети с прибитым блоком. Набор методов — объединение «узких
 * интерфейсов» всех шести ридеров: больше им ничего не нужно, и выдавать
 * наружу весь PublicClient незачем.
 */
export interface PinnedClient {
  getBalance(args: { address: Address }): Promise<bigint>;
  multicall(args: Record<string, unknown>): Promise<readonly unknown[]>;
  readContract(args: Record<string, unknown>): Promise<unknown>;
  getBlock(args?: {
    blockNumber?: bigint;
  }): Promise<{ number: bigint | null; timestamp: bigint }>;
}

/** Минимум, который должен уметь настоящий клиент, чтобы его прибили. */
export interface SourceClient extends BlockRpcClient {
  getBalance(args: Record<string, unknown>): Promise<bigint>;
  multicall(args: Record<string, unknown>): Promise<readonly unknown[]>;
  readContract(args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Клиент, подставляющий blockNumber во все чтения состояния.
 *
 * Делегирование выписано явно, а не Proxy: методов четыре, они и так
 * перечислены в интерфейсах ридеров, а Proxy поверх viem-клиента ловил бы
 * ещё и его внутренние геттеры (`extend`, `chain`, `transport`) — цена
 * неочевидного поведения выше экономии пяти строк.
 *
 * getBlock() без аргументов отвечает ПРИБИТЫМ блоком, а не головой цепочки.
 * Это важно: blockAtTimestamp внутри Uniswap-ридера спрашивает голову, чтобы
 * отмерить от неё сутки назад, и с настоящей головой окно комиссий уехало бы
 * в сегодня — то есть в данные, которых на ту дату не существовало.
 */
export function pinClientToBlock(
  client: SourceClient,
  blockNumber: bigint,
): PinnedClient {
  /** Номер блока ставится, только если вызывающий не выбрал свой. */
  const at = <T extends Record<string, unknown>>(args: T): T =>
    args.blockNumber === undefined ? { ...args, blockNumber } : args;

  return {
    getBalance: (args) => client.getBalance(at(args)),
    multicall: (args) => client.multicall(at(args)),
    readContract: (args) => client.readContract(at(args)),
    getBlock: (args) => client.getBlock(at(args ?? {})),
  };
}

/** Что удалось прибить, а что нет: сеть без архива — не повод терять точку. */
export interface HistoricalChains {
  /** Только сети, для которых блок найден. */
  clients: Partial<Record<ChainId, PinnedClient>>;
  blocks: Partial<Record<ChainId, PinnedBlock>>;
  /** Сети, по которым блок найти не удалось: попадут в причины частичности. */
  failed: { chain: ChainId; error: string }[];
}

export interface PinChainsOptions {
  /** Подмена клиентов (тесты); по умолчанию — архивные клиенты Alchemy. */
  clients?: Partial<Record<ChainId, SourceClient>>;
  maxProbes?: number;
}

/**
 * Блок на каждой сети под один и тот же момент времени.
 *
 * Сети идут параллельно и независимо: архив Optimism может не ответить,
 * когда Ethereum отвечает, и это должно стоить одной строки в причинах
 * частичности, а не всей точки истории.
 *
 * Момент в будущем молча не чинится: blockAtTimestamp вернёт голову цепочки,
 * и такой «исторический» снепшот был бы обычным текущим. Проверка здесь,
 * у единственного входа.
 */
export async function pinChainsAt(
  targetSec: bigint,
  opts: PinChainsOptions = {},
): Promise<HistoricalChains> {
  const maxProbes = opts.maxProbes ?? HISTORICAL_BLOCK_PROBES;
  const out: HistoricalChains = { clients: {}, blocks: {}, failed: [] };

  await Promise.all(
    CHAIN_IDS.map(async (chain) => {
      const client = opts.clients?.[chain] ?? (archiveClient(chain) as SourceClient | null);
      if (!client) {
        out.failed.push({
          chain,
          error: "нет ключа Alchemy — архивное чтение недоступно",
        });
        return;
      }

      let window: Awaited<ReturnType<typeof blockAtTimestamp>>;
      try {
        window = await blockAtTimestamp(client, targetSec, maxProbes);
      } catch (err) {
        out.failed.push({
          chain,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      if (window === null) {
        out.failed.push({ chain, error: "блок по времени не найден" });
        return;
      }

      // Голова цепочки старше запрошенного момента — момент в будущем,
      // и «историей» тут был бы обычный текущий снимок
      if (window.from.block === window.latest.block && targetSec >= window.latest.timestamp) {
        out.failed.push({
          chain,
          error: "запрошенный момент не в прошлом этой сети",
        });
        return;
      }

      const drift = Number(window.from.timestamp - targetSec);
      out.blocks[chain] = {
        block: window.from.block,
        timestamp: window.from.timestamp,
        driftSec: drift,
      };
      out.clients[chain] = pinClientToBlock(client, window.from.block);
    }),
  );

  return out;
}
