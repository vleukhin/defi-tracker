import type { PositionRangeDto } from "@/lib/api/types";
import { tickToPrice } from "@/lib/chains/uniswap-math";
import { isStableSymbol } from "@/lib/stables";

/**
 * Ценовой диапазон CLMM-позиции в человеческих единицах.
 *
 * Тики и раскладка на токены отвечают «сколько чего лежит», но не на
 * вопрос, который стратегия задает первым (docs/07 §5, §6): где цена
 * относительно границ и близко ли выход. Отсюда три величины — обе
 * границы, текущая цена и положение между ними.
 *
 * ОРИЕНТАЦИЯ. Uniswap считает цену как «token1 за token0», а порядок
 * токенов в пуле задан адресами: у одной пары стейбл окажется token1,
 * у другой token0, и половина диапазонов читалась бы как «0,00042 WETH
 * за USDC». Поэтому котировкой выбирается стейбл, и пара всегда
 * показывается как «сколько стейбла за базовый актив». Если стейбла
 * нет (или их два), остается порядок пула.
 *
 * ПОЛОЖЕНИЕ считается по тикам, а не по ценам: тик — это логарифм цены,
 * и ликвидность распределена равномерно именно по тикам. Позиция вне
 * диапазона дает значение меньше нуля или больше единицы — отдельного
 * флага не нужно, знак и есть направление выхода.
 */

/**
 * Тик, дальше которого границы не показываются числом: это позиция
 * «на весь диапазон», у нее цена на краю — величина вроде 1e50.
 */
const FULL_RANGE_TICK = 800_000;

export interface LpRangeToken {
  symbol: string;
  decimals: number;
}

export interface LpRangeInput {
  tickLower: number;
  tickUpper: number;
  /** Текущий тик пула; null = не прочитан (строки до появления поля). */
  tick: number | null;
  token0: LpRangeToken;
  token1: LpRangeToken;
}

export function buildLpRange(input: LpRangeInput): PositionRangeDto | null {
  const { tickLower, tickUpper, tick, token0, token1 } = input;
  if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper)) return null;
  if (tickUpper <= tickLower) return null;

  // Стейбл в котировке: «1 820 USDC за WETH» вместо «0,00055 WETH за USDC»
  const invert = isStableSymbol(token0.symbol) && !isStableSymbol(token1.symbol);
  const base = invert ? token1 : token0;
  const quote = invert ? token0 : token1;

  const priceAt = (t: number): number | null => {
    if (Math.abs(t) >= FULL_RANGE_TICK) return null;
    const price = tickToPrice(t, token0.decimals, token1.decimals);
    if (price === null) return null;
    return invert ? 1 / price : price;
  };

  // При перевороте границы меняются местами: меньшая цена базового актива
  // соответствует БОЛЬШЕМУ тику пула
  const lowerPrice = priceAt(invert ? tickUpper : tickLower);
  const upperPrice = priceAt(invert ? tickLower : tickUpper);
  const currentPrice = tick === null ? null : priceAt(tick);

  let position: number | null = null;
  if (tick !== null && Number.isFinite(tick)) {
    const raw = (tick - tickLower) / (tickUpper - tickLower);
    position = invert ? 1 - raw : raw;
  }

  let outsidePercent: number | null = null;
  if (position !== null && currentPrice !== null) {
    if (position < 0 && lowerPrice !== null && lowerPrice > 0) {
      outsidePercent = (currentPrice / lowerPrice - 1) * 100;
    } else if (position > 1 && upperPrice !== null && upperPrice > 0) {
      outsidePercent = (currentPrice / upperPrice - 1) * 100;
    }
  }

  return {
    baseSymbol: base.symbol,
    quoteSymbol: quote.symbol,
    lowerPrice,
    upperPrice,
    currentPrice,
    position,
    outsidePercent,
  };
}
