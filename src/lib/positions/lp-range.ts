import type { PositionExitDto, PositionRangeDto } from "@/lib/api/types";
import {
  amount0ForLiquidity,
  amount1ForLiquidity,
  getSqrtRatioAtTick,
  tickToPrice,
} from "@/lib/chains/uniswap-math";
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
 *
 * ВЫХОД. У нижней границы позиция целиком в базовом активе, у верхней —
 * целиком в котировке: подешевел актив — на руках остается актив,
 * подорожал — остаются деньги. Количества считаются из ликвидности той же
 * формулой, что и текущий состав, и не требуют ни одного лишнего запроса.
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
  /** Ликвидность позиции строкой; без нее количества на выходе не считаются. */
  liquidity?: string | null;
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

  const exits = exitAmounts(input, invert);

  return {
    baseSymbol: base.symbol,
    quoteSymbol: quote.symbol,
    lowerPrice,
    upperPrice,
    currentPrice,
    position,
    outsidePercent,
    // Граница без числа — это «весь диапазон»: количество на ней
    // астрономическое и смысла не несет
    exitLower: lowerPrice === null ? null : exits.lower,
    exitUpper: upperPrice === null ? null : exits.upper,
  };
}

/**
 * Сколько токенов останется на каждой границе. У нижней цены базового
 * актива позиция целиком в нем самом, у верхней — целиком в котировке;
 * при перевернутой паре стороны меняются местами вместе с токенами.
 */
function exitAmounts(
  input: LpRangeInput,
  invert: boolean,
): { lower: PositionExitDto | null; upper: PositionExitDto | null } {
  const raw = input.liquidity;
  if (raw === undefined || raw === null || raw === "") {
    return { lower: null, upper: null };
  }

  let liquidity: bigint;
  try {
    liquidity = BigInt(raw);
  } catch {
    return { lower: null, upper: null };
  }
  if (liquidity <= 0n) return { lower: null, upper: null };

  // Тик вне допустимого предела роняет тик-математику исключением, а весь
  // DTO из-за одной кривой строки падать не должен
  let sqrtLower: bigint;
  let sqrtUpper: bigint;
  try {
    sqrtLower = getSqrtRatioAtTick(input.tickLower);
    sqrtUpper = getSqrtRatioAtTick(input.tickUpper);
  } catch {
    return { lower: null, upper: null };
  }

  const amount0 =
    Number(amount0ForLiquidity(sqrtLower, sqrtUpper, liquidity)) /
    10 ** input.token0.decimals;
  const amount1 =
    Number(amount1ForLiquidity(sqrtLower, sqrtUpper, liquidity)) /
    10 ** input.token1.decimals;

  const base = invert ? input.token1 : input.token0;
  const quote = invert ? input.token0 : input.token1;

  return {
    lower: {
      symbol: base.symbol,
      quantity: invert ? amount1 : amount0,
    },
    upper: {
      symbol: quote.symbol,
      quantity: invert ? amount0 : amount1,
    },
  };
}
