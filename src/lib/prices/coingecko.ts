import "server-only";
import { logApiCall } from "@/lib/metrics";
import { TokenBucket, createCoingeckoBucket } from "./token-bucket";

/**
 * Низкоуровневый клиент CoinGecko Demo API (ТЗ Часть 4 §4):
 * только с сервера, token-bucket 25/мин, backoff при 429,
 * батчи /simple/token_price до 100 адресов, /simple/price для нативных.
 */

const BASE_URL = "https://api.coingecko.com/api/v3";
const MAX_ADDRESSES_PER_CALL = 100;

// Один bucket на процесс (serverless-инстанс)
let sharedBucket: TokenBucket | null = null;
function getBucket(): TokenBucket {
  if (!sharedBucket) sharedBucket = createCoingeckoBucket();
  return sharedBucket;
}

export interface CoingeckoClientOptions {
  fetchFn?: typeof fetch;
  bucket?: TokenBucket;
  logCall?: typeof logApiCall;
}

async function cgFetch(
  path: string,
  params: Record<string, string>,
  opts: CoingeckoClientOptions,
): Promise<unknown> {
  const fetchFn = opts.fetchFn ?? fetch;
  const bucket = opts.bucket ?? getBucket();
  const logCall = opts.logCall ?? logApiCall;

  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const apiKey = process.env.COINGECKO_API_KEY;
  const headers: Record<string, string> = apiKey
    ? { "x-cg-demo-api-key": apiKey }
    : {};

  await bucket.take();
  let res = await fetchFn(url.toString(), { headers });

  // Одна повторная попытка с backoff при 429 (ТЗ §4)
  if (res.status === 429) {
    void logCall("coingecko", path, { ok: false });
    await new Promise((r) => setTimeout(r, 15_000));
    await bucket.take();
    res = await fetchFn(url.toString(), { headers });
  }

  void logCall("coingecko", path, { ok: res.ok });
  if (!res.ok) {
    throw new Error(`CoinGecko ${path}: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Цены ERC-20 по адресам контрактов: /simple/token_price/{platform}.
 * Возвращает map lowercase-адрес -> цена USD. Адреса без листинга
 * в ответе отсутствуют — это сигнал «нераспознанный актив».
 */
export async function fetchTokenPrices(
  platform: string,
  contractAddresses: string[],
  opts: CoingeckoClientOptions = {},
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < contractAddresses.length; i += MAX_ADDRESSES_PER_CALL) {
    const chunk = contractAddresses.slice(i, i + MAX_ADDRESSES_PER_CALL);
    const data = (await cgFetch(
      `/simple/token_price/${platform}`,
      {
        contract_addresses: chunk.join(","),
        vs_currencies: "usd",
      },
      opts,
    )) as Record<string, { usd?: number }>;
    for (const [addr, v] of Object.entries(data)) {
      if (typeof v?.usd === "number") out[addr.toLowerCase()] = v.usd;
    }
  }
  return out;
}

// --- Исторические цены (Фаза 8, S8.5) ---

/** Ряд цен: [мс, цена USD] и ИЗМЕРЕННЫЙ шаг между точками. */
export interface PriceSeries {
  points: [number, number][];
  /** null — точек меньше двух, шаг измерить не на чем. */
  stepSec: number | null;
}

/**
 * Кэш ряда цен на процесс, по образцу gmx-api.ts.
 *
 * Отдельной таблицы под это НЕ заводится: ряд нужен ровно на время работы
 * с формой переноса точки, а `coin_prices` хранит текущие цены, а не историю,
 * и подмешивать туда ряды значило бы завести второй смысл у одной таблицы.
 *
 * Границы округляются вниз до пятиминутных корзин: без этого «сейчас»
 * сдвигается на каждом нажатии и кэш не попадает никогда.
 */
const CHART_TTL_MS = 5 * 60 * 1000;
const CHART_BUCKET_SEC = 300;
const CHART_CACHE_MAX = 16;

const chartCache = new Map<
  string,
  { series: PriceSeries; fetchedAtMs: number }
>();

/** Только для тестов: сбрасывает процессный кэш рядов. */
export function resetMarketChartCache(): void {
  chartCache.clear();
}

export interface MarketChartOptions extends CoingeckoClientOptions {
  nowMs?: number;
}

/** Медианная дельта между точками — так шаг измеряется, а не угадывается. */
function measureStepSec(points: [number, number][]): number | null {
  if (points.length < 2) return null;
  const deltas: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const d = points[i][0] - points[i - 1][0];
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return null;
  deltas.sort((a, b) => a - b);
  return Math.round(deltas[Math.floor(deltas.length / 2)] / 1000);
}

/**
 * Ряд цен монеты на отрезке: /coins/{id}/market_chart/range.
 *
 * Границы в СЕКУНДАХ (CoinGecko принимает unix-секунды, не миллисекунды —
 * перепутать легко, а ответ на миллисекундах будет просто пустым).
 *
 * Шаг ряда не выводится из запрошенного размаха: CoinGecko выбирает
 * гранулярность сам и на границе суток меняет её без предупреждения.
 * Поэтому `stepSec` МЕРЯЕТСЯ по вернувшимся точкам — именно эта величина
 * и называется на экране как погрешность подстановки цены.
 */
export async function fetchMarketChartRange(
  id: string,
  fromSec: number,
  toSec: number,
  opts: MarketChartOptions = {},
): Promise<PriceSeries> {
  const nowMs = opts.nowMs ?? Date.now();
  const bucket = (sec: number) =>
    Math.floor(sec / CHART_BUCKET_SEC) * CHART_BUCKET_SEC;
  const key = `${id}:${bucket(fromSec)}:${bucket(toSec)}`;

  const hit = chartCache.get(key);
  if (hit && nowMs - hit.fetchedAtMs < CHART_TTL_MS) return hit.series;

  const data = (await cgFetch(
    `/coins/${id}/market_chart/range`,
    {
      vs_currency: "usd",
      from: String(Math.floor(fromSec)),
      to: String(Math.ceil(toSec)),
    },
    opts,
  )) as { prices?: unknown };

  const points: [number, number][] = [];
  if (Array.isArray(data.prices)) {
    for (const p of data.prices) {
      if (
        Array.isArray(p) &&
        typeof p[0] === "number" &&
        typeof p[1] === "number"
      ) {
        points.push([p[0], p[1]]);
      }
    }
  }
  points.sort((a, b) => a[0] - b[0]);

  const series: PriceSeries = { points, stepSec: measureStepSec(points) };

  chartCache.set(key, { series, fetchedAtMs: nowMs });
  // Map хранит порядок вставки: самая старая запись — первая
  while (chartCache.size > CHART_CACHE_MAX) {
    const oldest = chartCache.keys().next().value;
    if (oldest === undefined) break;
    chartCache.delete(oldest);
  }

  return series;
}

/**
 * Цены нативных монет по coingecko id: /simple/price.
 * Для всех 4 сетей нативная монета — ETH (id "ethereum").
 */
export async function fetchNativePrices(
  ids: string[],
  opts: CoingeckoClientOptions = {},
): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const data = (await cgFetch(
    "/simple/price",
    { ids: [...new Set(ids)].join(","), vs_currencies: "usd" },
    opts,
  )) as Record<string, { usd?: number }>;
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(data)) {
    if (typeof v?.usd === "number") out[id] = v.usd;
  }
  return out;
}
