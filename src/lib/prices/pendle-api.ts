import "server-only";
import type { ChainId } from "@/lib/chains/config";
import { logApiCall } from "@/lib/metrics";

/**
 * Справочник рынков Pendle (api-v2.pendle.finance/core) — откуда читателю
 * цепочки знать, какие PT, YT и LP вообще существуют.
 *
 * Резолвера «все позиции пользователя» у Pendle на цепочке нет, а рынков —
 * сотни, и новые появляются каждую неделю. Вести их список руками (как
 * allowlist токенов) значило бы молча терять позицию в каждом новом рынке.
 * Поэтому адреса берутся из API, а балансы и курс — с цепочки: API отвечает
 * на вопрос «где искать», цепочка — «сколько и почем». Ровно та же схема,
 * что у GM-пулов GMX.
 *
 * Эндпоинт /v1/dashboard/positions/database/{user} отдает готовые позиции
 * с оценкой, но в документации Pendle его нет — строить учет на нем нельзя.
 *
 * Проверено живыми запросами (19.10.2026):
 *   - limit больше 100 → 400 «limit must not be greater than 100», поэтому
 *     страницы по 100;
 *   - chainId фильтрует (Ethereum — 503 рынка, Arbitrum — 94, Base — 42,
 *     Optimism — 2), без него отдается 830 рынков по всем сетям;
 *   - pt / yt / sy приходят как «{chainId}-0x…», address — голым адресом;
 *   - impliedApy и underlyingApy — доли (0,05 = 5%), не проценты;
 *   - истекшие рынки в ответе есть, и мы их НЕ отбрасываем: погашенный PT
 *     стоит своих денег, пока его не забрали.
 */

const PENDLE_API_BASE = "https://api-v2.pendle.finance/core";
const PAGE_LIMIT = 100;

/** Защита от зацикливания, если API перестанет уменьшать страницы. */
const MAX_PAGES = 50;

export const PENDLE_CHAIN_IDS: Record<ChainId, number> = {
  ethereum: 1,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
};

export interface PendleMarket {
  /** Адрес рынка — он же адрес LP-токена; нижний регистр. */
  address: string;
  /** Имя базового инструмента, как в интерфейсе Pendle («sUSDe»). */
  name: string;
  /** Дата погашения, ISO. */
  expiry: string;
  pt: string;
  yt: string;
  sy: string;
  /** Подразумеваемая доходность PT на момент запроса, % годовых. */
  impliedApyPercent: number | null;
  /** Доходность базового актива, % годовых. */
  underlyingApyPercent: number | null;
}

export interface PendleApiOptions {
  fetchImpl?: typeof fetch;
  logCall?: typeof logApiCall;
  nowMs?: number;
}

interface RawMarket {
  address?: unknown;
  name?: unknown;
  expiry?: unknown;
  pt?: unknown;
  yt?: unknown;
  sy?: unknown;
  details?: { impliedApy?: unknown; underlyingApy?: unknown } | null;
}

interface MarketsPage {
  total?: unknown;
  results?: unknown;
}

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

/** «1-0xABC…» → «0xabc…»; чужая сеть или мусор → null. */
export function stripChainPrefix(value: unknown, chainId: number): string | null {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  const prefix = `${chainId}-`;
  const address = lower.startsWith(prefix) ? lower.slice(prefix.length) : lower;
  return ADDRESS_RE.test(address) ? address : null;
}

function percentOrNull(fraction: unknown): number | null {
  return typeof fraction === "number" && Number.isFinite(fraction)
    ? fraction * 100
    : null;
}

/**
 * Одна запись API → рынок. Запись без любого из адресов или без даты
 * погашения отбрасывается: такой рынок все равно нельзя ни прочитать,
 * ни показать честно.
 */
export function parseMarket(raw: RawMarket, chainId: number): PendleMarket | null {
  const address = stripChainPrefix(raw.address, chainId);
  const pt = stripChainPrefix(raw.pt, chainId);
  const yt = stripChainPrefix(raw.yt, chainId);
  const sy = stripChainPrefix(raw.sy, chainId);
  const expiryMs = typeof raw.expiry === "string" ? Date.parse(raw.expiry) : NaN;
  if (!address || !pt || !yt || !sy || Number.isNaN(expiryMs)) return null;
  return {
    address,
    name: typeof raw.name === "string" ? raw.name : pt,
    expiry: new Date(expiryMs).toISOString(),
    pt,
    yt,
    sy,
    impliedApyPercent: percentOrNull(raw.details?.impliedApy),
    underlyingApyPercent: percentOrNull(raw.details?.underlyingApy),
  };
}

/**
 * Кэш на процесс и сеть. Список рынков меняется редко, но impliedApy —
 * величина живая, поэтому TTL тот же, что у цен.
 */
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<ChainId, { markets: PendleMarket[]; fetchedAtMs: number }>();

/** Только для тестов: сбрасывает процессный кэш. */
export function resetPendleApiCache(): void {
  cache.clear();
}

/**
 * Все рынки сети, постранично. Бросает при недоступности: вызывающий обязан
 * трактовать это как «позиции Pendle неизвестны», а не как «их нет».
 */
export async function getPendleMarkets(
  chain: ChainId,
  opts: PendleApiOptions = {},
): Promise<PendleMarket[]> {
  const nowMs = opts.nowMs ?? Date.now();
  const cached = cache.get(chain);
  if (cached && nowMs - cached.fetchedAtMs < TTL_MS) return cached.markets;

  const doFetch = opts.fetchImpl ?? fetch;
  const logCall = opts.logCall ?? logApiCall;
  const chainId = PENDLE_CHAIN_IDS[chain];

  const markets: PendleMarket[] = [];
  let pages = 0;
  try {
    for (let skip = 0; pages < MAX_PAGES; skip += PAGE_LIMIT) {
      const url = `${PENDLE_API_BASE}/v2/markets/all?chainId=${chainId}&skip=${skip}&limit=${PAGE_LIMIT}`;
      const res = await doFetch(url);
      pages += 1;
      if (!res.ok) throw new Error(`Pendle markets ${chain}: HTTP ${res.status}`);
      const page = (await res.json()) as MarketsPage;
      if (!Array.isArray(page.results)) {
        throw new Error(`Pendle markets ${chain}: unexpected response`);
      }
      for (const raw of page.results as RawMarket[]) {
        const market = parseMarket(raw, chainId);
        if (market) markets.push(market);
      }
      const total = typeof page.total === "number" ? page.total : null;
      if (page.results.length < PAGE_LIMIT) break;
      if (total !== null && skip + PAGE_LIMIT >= total) break;
    }
    void logCall("pendle", `markets:${chain}`, { units: pages });
  } catch (err) {
    void logCall("pendle", `markets:${chain}`, { units: pages, ok: false });
    throw err instanceof Error ? err : new Error(String(err));
  }

  cache.set(chain, { markets, fetchedAtMs: nowMs });
  return markets;
}
