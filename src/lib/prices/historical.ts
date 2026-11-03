import "server-only";
import type { PriceInput } from "@/lib/portfolio/portfolio";
import {
  fetchMarketChartRange,
  type CoingeckoClientOptions,
} from "./coingecko";

/**
 * Цены монет на момент в прошлом — для восстановления пропущенной точки
 * истории (chains/historical.ts читает состояние, этот модуль его оценивает).
 *
 * Почему не coin_prices. В кэше лежит ОДНА текущая цена на монету, она
 * перезаписывается на месте и истории не имеет. Оценить вчерашний состав
 * сегодняшней ценой — это нарисовать вчерашнему дню сегодняшний рынок:
 * самая правдоподобная на вид и самая вредная из возможных ошибок, потому
 * что на графике она неотличима от настоящего движения портфеля.
 *
 * Источник — /coins/{id}/market_chart/range, те же реальные котировки, что
 * у формы переноса точки. Ничего не интерполируется: берётся БЛИЖАЙШАЯ
 * фактическая точка ряда, а насколько она отстоит от запрошенного момента —
 * возвращается вызывающему и попадает в причины частичности.
 */

/**
 * Полуширина окна запроса. Шесть часов — не про точность, а про гранулярность:
 * на отрезке до суток CoinGecko отдаёт пятиминутные точки, на более широком
 * переключается на часовые, молча и без отметки в ответе.
 */
const WINDOW_HALF_SEC = 3 * 3600;

/**
 * Дальше этого ближайшая точка считается несовпадением: цена есть, но она
 * не про запрошенный момент. Час — шаг часового ряда, то есть худшее, что
 * CoinGecko отдаёт на годовой глубине.
 */
export const PRICE_MATCH_TOLERANCE_SEC = 3600;

export interface HistoricalPrice extends PriceInput {
  /** Насколько фактическая точка отстоит от запрошенного момента, секунды. */
  offsetSec: number;
}

export interface HistoricalPricesOptions extends CoingeckoClientOptions {
  /** Подмена загрузчика ряда (тесты). */
  fetchRange?: typeof fetchMarketChartRange;
  windowHalfSec?: number;
}

/** Ближайшая по времени точка ряда; null — ряд пуст. */
export function nearestPoint(
  points: readonly [number, number][],
  targetMs: number,
): [number, number] | null {
  let best: [number, number] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const p of points) {
    const d = Math.abs(p[0] - targetMs);
    if (d < bestDistance) {
      bestDistance = d;
      best = p;
    }
  }
  return best;
}

/**
 * Цены монет на момент targetSec по coingecko id.
 *
 * Монеты идут ПОСЛЕДОВАТЕЛЬНО, а не веером: это один вызов CoinGecko на
 * монету, а token-bucket у клиента общий на процесс — параллельный веер
 * упёрся бы в 429 и ушёл в пятнадцатисекундный backoff на каждой монете.
 * Скрипт восстановления никуда не торопится.
 *
 * Монета, по которой ряд не отдался, в результат НЕ попадает: отсутствие
 * ключа движок читает как «цены нет» и честно помечает точку частичной.
 * Подстановка текущей цены вместо исторической здесь была бы молчаливым
 * враньём ровно того сорта, ради которого модуль и написан.
 */
export async function getHistoricalCoinPrices(
  ids: readonly string[],
  targetSec: number,
  opts: HistoricalPricesOptions = {},
): Promise<Map<string, HistoricalPrice>> {
  const out = new Map<string, HistoricalPrice>();
  const wanted = [...new Set(ids)].filter((id) => id.length > 0);
  if (wanted.length === 0) return out;

  const fetchRange = opts.fetchRange ?? fetchMarketChartRange;
  const half = opts.windowHalfSec ?? WINDOW_HALF_SEC;
  const targetMs = targetSec * 1000;

  for (const id of wanted) {
    let series;
    try {
      series = await fetchRange(id, targetSec - half, targetSec + half, opts);
    } catch (err) {
      console.warn(
        `[historical-prices] ${id}: ряд не получен: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }

    const point = nearestPoint(series.points, targetMs);
    if (point === null) {
      console.warn(`[historical-prices] ${id}: ряд пуст на запрошенном окне`);
      continue;
    }

    const offsetSec = Math.round(Math.abs(point[0] - targetMs) / 1000);
    out.set(id, {
      priceUsd: point[1],
      // Время ФАКТИЧЕСКОЙ точки, а не запрошенный момент: по нему видно,
      // куда именно промахнулись, и оно же уходит в снепшот
      fetchedAt: new Date(point[0]).toISOString(),
      // Та же семантика, что у живого пути: «цена не про этот момент»
      stale: offsetSec > PRICE_MATCH_TOLERANCE_SEC,
      offsetSec,
    });
  }

  return out;
}
