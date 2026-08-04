/**
 * Тик-математика Uniswap v3 (S5.2) — чистые функции, без сети и без SDK.
 *
 * Почему не @uniswap/v3-sdk: он тянет JSBI и половину монорепы ради двух
 * формул, которые здесь занимают полсотни строк на нативных bigint.
 *
 * Все вычисления целочисленные, как в контрактах. Считать sqrt(1.0001^tick)
 * во float нельзя: 2^96 уже за пределами точности double, и ошибка уезжает
 * в количества токенов.
 */

const Q96 = 1n << 96n;
const MAX_UINT256 = (1n << 256n) - 1n;

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

/**
 * TickMath.getSqrtRatioAtTick: sqrt(1.0001^tick) в формате Q64.96.
 * Побитовая версия из контракта — каждая константа отвечает за свой бит
 * абсолютного значения тика.
 */
export function getSqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`тик вне допустимого диапазона: ${tick}`);
  }
  const absTick = BigInt(Math.abs(tick));

  let ratio =
    (absTick & 0x1n) !== 0n
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;

  const mul = (bit: bigint, constant: bigint) => {
    if ((absTick & bit) !== 0n) ratio = (ratio * constant) >> 128n;
  };

  mul(0x2n, 0xfff97272373d413259a46990580e213an);
  mul(0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn);
  mul(0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n);
  mul(0x10n, 0xffcb9843d60f6159c9db58835c926644n);
  mul(0x20n, 0xff973b41fa98c081472e6896dfb254c0n);
  mul(0x40n, 0xff2ea16466c96a3843ec78b326b52861n);
  mul(0x80n, 0xfe5dee046a99a2a811c461f1969c3053n);
  mul(0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n);
  mul(0x200n, 0xf987a7253ac413176f2b074cf7815e54n);
  mul(0x400n, 0xf3392b0822b70005940c7a398e4b70f3n);
  mul(0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n);
  mul(0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n);
  mul(0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n);
  mul(0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n);
  mul(0x8000n, 0x31be135f97d08fd981231505542fcfa6n);
  mul(0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n);
  mul(0x20000n, 0x5d6af8dedb81196699c329225ee604n);
  mul(0x40000n, 0x2216e584f5fa1ea926041bedfe98n);
  mul(0x80000n, 0x48a170391f7dc42444e8fa2n);

  if (tick > 0) ratio = MAX_UINT256 / ratio;

  // Q128.128 -> Q64.96 с округлением вверх, как в контракте
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

/** LiquidityAmounts.getAmount0ForLiquidity. */
export function amount0ForLiquidity(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidity: bigint,
): bigint {
  const [lo, hi] =
    sqrtRatioA > sqrtRatioB ? [sqrtRatioB, sqrtRatioA] : [sqrtRatioA, sqrtRatioB];
  if (lo === 0n) return 0n;
  return ((liquidity << 96n) * (hi - lo)) / hi / lo;
}

/** LiquidityAmounts.getAmount1ForLiquidity. */
export function amount1ForLiquidity(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidity: bigint,
): bigint {
  const [lo, hi] =
    sqrtRatioA > sqrtRatioB ? [sqrtRatioB, sqrtRatioA] : [sqrtRatioA, sqrtRatioB];
  return (liquidity * (hi - lo)) / Q96;
}

export interface PositionAmounts {
  amount0: bigint;
  amount1: bigint;
  /**
   * Позиция вне диапазона — она целиком в одном активе, и это не сбой, а
   * ее фактическое состояние (S5.2): показываем как есть.
   */
  inRange: boolean;
}

/**
 * Количества токенов позиции при текущей цене пула.
 *
 * Три случая ровно как в LiquidityAmounts.getAmountsForLiquidity:
 * цена ниже диапазона — все в token0; внутри — обе части; выше — все в token1.
 */
export function positionAmounts(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
): PositionAmounts {
  const sqrtLower = getSqrtRatioAtTick(tickLower);
  const sqrtUpper = getSqrtRatioAtTick(tickUpper);

  if (sqrtPriceX96 <= sqrtLower) {
    return {
      amount0: amount0ForLiquidity(sqrtLower, sqrtUpper, liquidity),
      amount1: 0n,
      inRange: false,
    };
  }
  if (sqrtPriceX96 < sqrtUpper) {
    return {
      amount0: amount0ForLiquidity(sqrtPriceX96, sqrtUpper, liquidity),
      amount1: amount1ForLiquidity(sqrtLower, sqrtPriceX96, liquidity),
      inRange: true,
    };
  }
  return {
    amount0: 0n,
    amount1: amount1ForLiquidity(sqrtLower, sqrtUpper, liquidity),
    inRange: false,
  };
}

/**
 * Аккумулятор комиссий диапазона — Tick.getFeeGrowthInside из v3-core.
 *
 * feeGrowthGlobal — комиссии на единицу ликвидности за всю историю пула;
 * feeGrowthOutside граничного тика — та их часть, что накопилась ПО ТУ СТОРОНУ
 * тика. Вычитанием обеих сторон остается доля диапазона.
 *
 * Ликвидность принадлежит конкретному диапазону, поэтому границы здесь —
 * границы позиции, а не пула: две позиции в одном пуле с разными тиками дают
 * разные значения. Значение растет только пока текущий тик внутри границ, так
 * что «сколько времени цена простояла в диапазоне» отдельно считать не нужно —
 * это уже учтено.
 *
 * ВСЯ арифметика по модулю 2^256, и это не небрежность. v3-core написан на
 * Solidity 0.7.6, где переполнение не проверяется, а Tick.update при
 * инициализации кладет feeGrowthOutside = feeGrowthGlobal — из-за этого в
 * живых пулах и промежуточные разности, и сам inside регулярно «завернутые»
 * числа. Смысл имеет только РАЗНИЦА двух inside, и она верна ровно потому,
 * что оба завернулись одинаково. Убрать asUintN — значит получить
 * отрицательные bigint там, где контракт видит большое положительное.
 *
 * Ветки несимметричны — `>=` снизу и `<` сверху, как в контракте. Разница
 * видна, только когда цена стоит ровно на границе диапазона.
 */
export function feeGrowthInside(
  tickCurrent: number,
  tickLower: number,
  tickUpper: number,
  feeGrowthGlobalX128: bigint,
  feeGrowthOutsideLowerX128: bigint,
  feeGrowthOutsideUpperX128: bigint,
): bigint {
  const below =
    tickCurrent >= tickLower
      ? feeGrowthOutsideLowerX128
      : BigInt.asUintN(256, feeGrowthGlobalX128 - feeGrowthOutsideLowerX128);
  const above =
    tickCurrent < tickUpper
      ? feeGrowthOutsideUpperX128
      : BigInt.asUintN(256, feeGrowthGlobalX128 - feeGrowthOutsideUpperX128);

  return BigInt.asUintN(256, feeGrowthGlobalX128 - below - above);
}

/**
 * Потолок правдоподобия: столько комиссий позиция накопить не может.
 *
 * Контракт хранит начисленное в uint128 и на этом рубеже сам бы обрезал.
 * Реальные сутки дают величину порядка 1e20 «сырых» единиц, 2^128 ~ 3.4e38 —
 * запас огромный. Смысл потолка в другом: если какая-то защита не сработала и
 * окно оказалось несопоставимым, завернутая разность дает мусор около 2^256.
 * Лучше отдать «неизвестно», чем поставить этот мусор в заголовок карточки.
 */
const MAX_PLAUSIBLE_FEES = 1n << 128n;

/**
 * Комиссии позиции за окно: Position.update, только между двумя блоками.
 *
 * Множитель — ликвидность ЭТОЙ позиции, не pool.liquidity(). Формула
 * предполагает, что ликвидность внутри окна не менялась; проверяет это
 * вызывающий, здесь — только арифметика.
 *
 * Деление на 2^128 сдвигом: FullMath.mulDiv округляет вниз, сдвиг bigint тоже.
 *
 * null = «неизвестно». Ноль — законный ответ: позиция, простоявшая окно вне
 * диапазона, заработала ровно ноль, и это содержательная величина.
 */
export function feesFromGrowth(
  liquidity: bigint,
  feeGrowthInsideNowX128: bigint,
  feeGrowthInsideThenX128: bigint,
): bigint | null {
  if (liquidity < 0n) return null;

  const delta = BigInt.asUintN(
    256,
    feeGrowthInsideNowX128 - feeGrowthInsideThenX128,
  );
  const fees = (delta * liquidity) >> 128n;

  return fees >= MAX_PLAUSIBLE_FEES ? null : fees;
}

/**
 * Цена по тику в человеческих единицах: сколько token1 за один token0.
 *
 * Здесь, в отличие от количеств, считать во float МОЖНО и нужно: это число
 * идет на экран, а не в раскладку позиции. Точность double на пять значащих
 * цифр цены с запасом, а bigint пришлось бы делить с потерей знаков.
 *
 * Экспонента через Math.exp, а не Math.pow(1.0001, tick): на краях
 * диапазона тиков pow теряет точность быстрее. Цена на самом краю
 * (±887 272) — величина вроде 1e50: это позиция «на весь диапазон»,
 * и границы у нее показываются словами, а не числом (см. lp-range).
 */
const LN_TICK_BASE = Math.log(1.0001);

export function tickToPrice(
  tick: number,
  decimals0: number,
  decimals1: number,
): number | null {
  if (!Number.isFinite(tick)) return null;
  const price =
    Math.exp(tick * LN_TICK_BASE) * Math.pow(10, decimals0 - decimals1);
  return Number.isFinite(price) && price > 0 ? price : null;
}
