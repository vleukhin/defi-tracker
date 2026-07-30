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
