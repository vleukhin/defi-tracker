import "server-only";
import { numberToHex } from "viem";
import { alchemyRpcUrl, getChainClients, type ChainId } from "./config";
import { addressTopic, TRANSFER_TOPIC } from "./gm-transfers";
import { holdingStart, type TokenTransfer } from "@/lib/positions/held-since";
import { logApiCall } from "@/lib/metrics";

/**
 * Дата покупки токена Pendle — по истории ERC-20 переводов на кошелёк.
 *
 * Два пути, как у поиска операций GM (gm-search.ts):
 *   1) alchemy_getAssetTransfers — сразу с временем блока, без ограничений
 *      по глубине;
 *   2) запасной — eth_getLogs по токену и кошельку на всю историю. Фильтр
 *      узкий (адрес токена + сторона кошелька), поэтому ответ маленький, но
 *      часть публичных узлов режет диапазон блоков — тогда ответа нет.
 *
 * Ищется ОДИН раз на позицию: дальше дата переносится из прошлого чтения
 * (attachPendleHeldSince), как момент выхода CLMM из диапазона. Не нашли —
 * null, и попытка повторится при следующем обновлении; подставлять дату
 * запуска рынка или «сегодня» нельзя — это другая величина.
 */

/** Потолок страниц Alchemy: тысяча переводов одного токена — уже не позиция владельца. */
const MAX_PAGES = 5;

export interface HeldSinceDeps {
  fetchFn: typeof fetch;
  alchemyUrl: (chain: ChainId) => string | null;
  client: (chain: ChainId) => HeldSinceRpcClient;
  logCall: typeof logApiCall;
}

/** Узкий интерфейс узла — модуль тестируется без сети. */
export interface HeldSinceRpcClient {
  request(args: { method: "eth_getLogs"; params: [unknown] }): Promise<unknown>;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
}

const defaultDeps = (): HeldSinceDeps => ({
  fetchFn: fetch,
  alchemyUrl: alchemyRpcUrl,
  client: (chain) =>
    getChainClients()[chain] as unknown as HeldSinceRpcClient,
  logCall: logApiCall,
});

interface AlchemyTransfer {
  blockNum?: unknown;
  uniqueId?: unknown;
  rawContract?: { value?: unknown };
  metadata?: { blockTimestamp?: unknown };
}

/** «0xhash:log:12» → 12; у ERC-20 переводов Alchemy индекс лога в uniqueId. */
function logIndexOf(uniqueId: unknown): number {
  if (typeof uniqueId !== "string") return 0;
  const n = Number(uniqueId.split(":").pop());
  return Number.isFinite(n) ? n : 0;
}

export function parseAlchemyPage(
  result: unknown,
  direction: TokenTransfer["direction"],
): { transfers: TokenTransfer[]; pageKey: string | null } {
  const body = result as { transfers?: unknown; pageKey?: unknown };
  const transfers: TokenTransfer[] = [];
  for (const t of Array.isArray(body?.transfers) ? (body.transfers as AlchemyTransfer[]) : []) {
    // Количество — только из rawContract.value: поле value у Alchemy — float
    const value = t.rawContract?.value;
    if (typeof value !== "string" || typeof t.blockNum !== "string") continue;
    const stamp = t.metadata?.blockTimestamp;
    const ms = typeof stamp === "string" ? Date.parse(stamp) : NaN;
    transfers.push({
      block: BigInt(t.blockNum),
      logIndex: logIndexOf(t.uniqueId),
      direction,
      amount: BigInt(value),
      timestampSec: Number.isNaN(ms) ? null : BigInt(Math.floor(ms / 1000)),
    });
  }
  return {
    transfers,
    pageKey: typeof body?.pageKey === "string" ? body.pageKey : null,
  };
}

async function viaAlchemy(
  url: string,
  token: string,
  wallet: string,
  deps: HeldSinceDeps,
): Promise<TokenTransfer[]> {
  const side = async (direction: TokenTransfer["direction"]) => {
    const out: TokenTransfer[] = [];
    let pageKey: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await deps.fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "alchemy_getAssetTransfers",
          params: [
            {
              category: ["erc20"],
              contractAddresses: [token],
              ...(direction === "in" ? { toAddress: wallet } : { fromAddress: wallet }),
              order: "asc",
              withMetadata: true,
              fromBlock: "0x0",
              toBlock: "latest",
              maxCount: "0x3e8",
              ...(pageKey ? { pageKey } : {}),
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`alchemy_getAssetTransfers: HTTP ${res.status}`);
      const json = (await res.json()) as { result?: unknown; error?: { message?: unknown } };
      if (json.error) {
        throw new Error(
          typeof json.error.message === "string" ? json.error.message : "alchemy: ошибка",
        );
      }
      const parsed = parseAlchemyPage(json.result, direction);
      out.push(...parsed.transfers);
      pageKey = parsed.pageKey;
      if (!pageKey) return out;
    }
    // История длиннее потолка — неполная, а неполная история может дать
    // неверное начало. Лучше «не знаем»
    throw new Error("alchemy_getAssetTransfers: история длиннее потолка страниц");
  };
  const [incoming, outgoing] = await Promise.all([side("in"), side("out")]);
  return [...incoming, ...outgoing];
}

interface RawLog {
  blockNumber?: unknown;
  logIndex?: unknown;
  data?: unknown;
}

export function parseLogs(
  logs: unknown,
  direction: TokenTransfer["direction"],
): TokenTransfer[] {
  if (!Array.isArray(logs)) throw new Error("eth_getLogs: неожиданный ответ");
  const out: TokenTransfer[] = [];
  for (const l of logs as RawLog[]) {
    if (typeof l.blockNumber !== "string" || typeof l.data !== "string") continue;
    out.push({
      block: BigInt(l.blockNumber),
      logIndex: typeof l.logIndex === "string" ? Number(BigInt(l.logIndex)) : 0,
      direction,
      amount: l.data === "0x" ? 0n : BigInt(l.data),
      timestampSec: null,
    });
  }
  return out;
}

async function viaLogs(
  client: HeldSinceRpcClient,
  token: string,
  wallet: string,
): Promise<TokenTransfer[]> {
  const walletTopic = addressTopic(wallet);
  const ask = (direction: TokenTransfer["direction"]) =>
    client
      .request({
        method: "eth_getLogs",
        params: [
          {
            address: token,
            topics:
              direction === "in"
                ? [TRANSFER_TOPIC, null, walletTopic]
                : [TRANSFER_TOPIC, walletTopic],
            fromBlock: numberToHex(0n),
            toBlock: "latest",
          },
        ],
      })
      .then((logs) => parseLogs(logs, direction));
  const [incoming, outgoing] = await Promise.all([ask("in"), ask("out")]);
  return [...incoming, ...outgoing];
}

/** Начало текущего удержания токена, ISO; null = не удалось установить. */
export async function findHeldSince(
  chain: ChainId,
  token: string,
  wallet: string,
  deps: HeldSinceDeps = defaultDeps(),
): Promise<string | null> {
  const lowerToken = token.toLowerCase();
  const lowerWallet = wallet.toLowerCase();
  const client = deps.client(chain);

  let transfers: TokenTransfer[] | null = null;
  const url = deps.alchemyUrl(chain);
  if (url) {
    try {
      transfers = await viaAlchemy(url, lowerToken, lowerWallet, deps);
      void deps.logCall("alchemy", `pendle:${chain}:held`, { units: 2 });
    } catch (err) {
      void deps.logCall("alchemy", `pendle:${chain}:held`, { units: 2, ok: false });
      console.warn(`[pendle-held] ${chain} ${lowerToken}: Alchemy: ${String(err)}`);
    }
  }
  if (transfers === null) {
    try {
      transfers = await viaLogs(client, lowerToken, lowerWallet);
      void deps.logCall("rpc", `pendle:${chain}:held-logs`, { units: 2 });
    } catch (err) {
      void deps.logCall("rpc", `pendle:${chain}:held-logs`, { units: 2, ok: false });
      console.warn(`[pendle-held] ${chain} ${lowerToken}: eth_getLogs: ${String(err)}`);
      return null;
    }
  }

  const start = holdingStart(transfers);
  if (start === null) return null;

  let sec = start.timestampSec;
  if (sec === null) {
    try {
      sec = (await client.getBlock({ blockNumber: start.block })).timestamp;
    } catch (err) {
      console.warn(`[pendle-held] ${chain}: время блока ${start.block}: ${String(err)}`);
      return null;
    }
  }
  return new Date(Number(sec) * 1000).toISOString();
}
