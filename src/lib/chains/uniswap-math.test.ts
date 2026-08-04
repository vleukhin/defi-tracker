import { describe, expect, it } from "vitest";
import {
  MAX_TICK,
  MIN_TICK,
  amount0ForLiquidity,
  amount1ForLiquidity,
  feeGrowthInside,
  feesFromGrowth,
  getSqrtRatioAtTick,
  positionAmounts,
  tickToPrice,
} from "./uniswap-math";

/**
 * Опорные значения взяты из самих контрактов Uniswap v3 (TickMath):
 * одна перепутанная константа в побитовом разложении тихо смещает
 * количества токенов, и заметить это по глазам невозможно.
 */

const Q96 = 1n << 96n;

describe("getSqrtRatioAtTick", () => {
  it("тик 0 дает ровно 2^96", () => {
    expect(getSqrtRatioAtTick(0)).toBe(Q96);
  });

  it("границы совпадают с MIN_SQRT_RATIO / MAX_SQRT_RATIO контракта", () => {
    expect(getSqrtRatioAtTick(MIN_TICK)).toBe(4295128739n);
    expect(getSqrtRatioAtTick(MAX_TICK)).toBe(
      1461446703485210103287273052203988822378723970342n,
    );
  });

  it("монотонно возрастает по тику", () => {
    let prev = getSqrtRatioAtTick(-500_000);
    for (const tick of [-100_000, -10_000, -1, 0, 1, 10_000, 100_000, 500_000]) {
      const next = getSqrtRatioAtTick(tick);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }
  });

  it("тик t и −t дают взаимно обратные отношения (с точностью округления)", () => {
    for (const tick of [1, 887, 10_000, 202_918]) {
      const up = getSqrtRatioAtTick(tick);
      const down = getSqrtRatioAtTick(-tick);
      // up * down ≈ 2^192; допускаем относительную ошибку 1e-9
      const product = up * down;
      const expected = Q96 * Q96;
      const diff =
        product > expected ? product - expected : expected - product;
      expect(Number(diff) / Number(expected)).toBeLessThan(1e-9);
    }
  });

  it("цена растет на 0,01% за тик", () => {
    // sqrt(1.0001) на тик => ratio(1)/ratio(0) ≈ 1,00005
    const step = Number(getSqrtRatioAtTick(1)) / Number(getSqrtRatioAtTick(0));
    expect(step).toBeCloseTo(Math.sqrt(1.0001), 9);
  });

  it("отвергает тик вне диапазона", () => {
    expect(() => getSqrtRatioAtTick(MAX_TICK + 1)).toThrow();
    expect(() => getSqrtRatioAtTick(MIN_TICK - 1)).toThrow();
    expect(() => getSqrtRatioAtTick(1.5)).toThrow();
  });
});

describe("positionAmounts", () => {
  const tickLower = -1000;
  const tickUpper = 1000;
  const liquidity = 10n ** 18n;

  it("цена ниже диапазона — все в token0", () => {
    const below = getSqrtRatioAtTick(tickLower - 100);
    const r = positionAmounts(below, tickLower, tickUpper, liquidity);
    expect(r.inRange).toBe(false);
    expect(r.amount1).toBe(0n);
    expect(r.amount0).toBeGreaterThan(0n);
  });

  it("цена выше диапазона — все в token1 (позиция вне диапазона, не сбой)", () => {
    const above = getSqrtRatioAtTick(tickUpper + 100);
    const r = positionAmounts(above, tickLower, tickUpper, liquidity);
    expect(r.inRange).toBe(false);
    expect(r.amount0).toBe(0n);
    expect(r.amount1).toBeGreaterThan(0n);
  });

  it("внутри диапазона — обе части ненулевые", () => {
    const r = positionAmounts(Q96, tickLower, tickUpper, liquidity);
    expect(r.inRange).toBe(true);
    expect(r.amount0).toBeGreaterThan(0n);
    expect(r.amount1).toBeGreaterThan(0n);
  });

  it("в симметричном диапазоне при цене 1 части равны", () => {
    const r = positionAmounts(Q96, tickLower, tickUpper, liquidity);
    const diff =
      r.amount0 > r.amount1 ? r.amount0 - r.amount1 : r.amount1 - r.amount0;
    expect(Number(diff) / Number(r.amount0)).toBeLessThan(1e-6);
  });

  it("на границе tickLower позиция уже целиком в token0", () => {
    const r = positionAmounts(
      getSqrtRatioAtTick(tickLower),
      tickLower,
      tickUpper,
      liquidity,
    );
    expect(r.amount1).toBe(0n);
  });

  it("нулевая ликвидность дает нулевые количества", () => {
    const r = positionAmounts(Q96, tickLower, tickUpper, 0n);
    expect(r.amount0).toBe(0n);
    expect(r.amount1).toBe(0n);
  });
});

describe("формулы количеств", () => {
  it("порядок границ не важен", () => {
    const a = getSqrtRatioAtTick(-500);
    const b = getSqrtRatioAtTick(500);
    const l = 10n ** 20n;
    expect(amount0ForLiquidity(a, b, l)).toBe(amount0ForLiquidity(b, a, l));
    expect(amount1ForLiquidity(a, b, l)).toBe(amount1ForLiquidity(b, a, l));
  });

  it("amount1 при равных границах равен нулю", () => {
    const a = getSqrtRatioAtTick(100);
    expect(amount1ForLiquidity(a, a, 10n ** 20n)).toBe(0n);
    expect(amount0ForLiquidity(a, a, 10n ** 20n)).toBe(0n);
  });
});

describe("tickToPrice", () => {
  it("нулевой тик = паритет с поправкой на decimals", () => {
    // Одинаковые decimals: 1.0001^0 = 1
    expect(tickToPrice(0, 18, 18)).toBeCloseTo(1, 12);
    // WETH(18)/USDC(6): множитель 10^12 переводит «за штуку»
    expect(tickToPrice(0, 18, 6)!).toBeCloseTo(1e12, 0);
  });

  it("шаг тика — 0,01% цены", () => {
    const a = tickToPrice(0, 18, 18)!;
    const b = tickToPrice(1, 18, 18)!;
    expect(b / a).toBeCloseTo(1.0001, 9);
  });

  it("реальный тик WETH/USDC считается в доллары за ETH", () => {
    // Тик −201 240 у пары WETH(18)/USDC(6) — это ~1820 USDC за WETH
    const price = tickToPrice(-201_240, 18, 6)!;
    expect(price).toBeGreaterThan(1750);
    expect(price).toBeLessThan(1900);
  });

  it("мусор вместо тика -> null, а не NaN на экране", () => {
    expect(tickToPrice(Number.NaN, 18, 18)).toBeNull();
    expect(tickToPrice(Number.POSITIVE_INFINITY, 18, 18)).toBeNull();
  });
});

/**
 * Аккумулятор диапазона. Проверяются две вещи, которые глазами не ловятся:
 * асимметрия веток на границах и заворачивание по модулю 2^256.
 */
describe("feeGrowthInside", () => {
  const tickLower = -1000;
  const tickUpper = 1000;
  // Разные константы нарочно: перепутанные below/above иначе не отличить
  const global = 1_000_000n;
  const outsideLower = 30_000n;
  const outsideUpper = 7_000n;

  const inside = (tickCurrent: number) =>
    feeGrowthInside(
      tickCurrent,
      tickLower,
      tickUpper,
      global,
      outsideLower,
      outsideUpper,
    );

  it("цена внутри диапазона — вычитаются обе стороны как есть", () => {
    expect(inside(0)).toBe(global - outsideLower - outsideUpper);
  });

  it("цена ниже диапазона — нижняя сторона берется дополнением", () => {
    // below = global − outsideLower, above = outsideUpper
    expect(inside(-2000)).toBe(BigInt.asUintN(256, outsideLower - outsideUpper));
  });

  it("цена выше диапазона — дополнением берется верхняя сторона", () => {
    // Здесь outsideUpper < outsideLower, поэтому результат заворачивается
    expect(inside(2000)).toBe(BigInt.asUintN(256, outsideUpper - outsideLower));
    expect(inside(2000)).toBeGreaterThan(1n << 255n);
  });

  it("на нижней границе работает ветка >= : тик считается внутри", () => {
    expect(inside(tickLower)).toBe(inside(0));
    expect(inside(tickLower)).not.toBe(inside(tickLower - 1));
  });

  it("на верхней границе работает ветка < : тик считается снаружи", () => {
    expect(inside(tickUpper)).toBe(inside(tickUpper + 1));
    expect(inside(tickUpper)).not.toBe(inside(tickUpper - 1));
  });

  it("inside законно заворачивается, когда сторон больше глобального", () => {
    // Так и бывает в живых пулах: Tick.update кладет outside = global
    const wrapped = feeGrowthInside(0, tickLower, tickUpper, 10n, 8n, 7n);
    expect(wrapped).toBe(BigInt.asUintN(256, -5n));
    expect(wrapped).toBeGreaterThan(1n << 255n);
  });
});

describe("feesFromGrowth", () => {
  it("комиссии = дельта × ликвидность / 2^128", () => {
    expect(feesFromGrowth(5n, 3n << 128n, 0n)).toBe(15n);
  });

  it("дельта заворачивается через ноль — окно не теряется", () => {
    // insideThen у самого верха uint256, insideNow уже за переполнением
    const then = (1n << 256n) - 5n;
    const now = 3n;
    expect(feesFromGrowth(1n << 128n, now, then)).toBe(8n);
  });

  it("округление вниз, как FullMath.mulDiv", () => {
    // 1,5 * 2^128 при ликвидности 1 -> ровно 1
    expect(feesFromGrowth(1n, (1n << 128n) + (1n << 127n), 0n)).toBe(1n);
  });

  it("нулевая ликвидность дает ноль, а не «неизвестно»", () => {
    expect(feesFromGrowth(0n, 3n << 128n, 0n)).toBe(0n);
  });

  it("позиция вне диапазона все окно: дельты нет — настоящий ноль", () => {
    expect(feesFromGrowth(10n ** 18n, 42n, 42n)).toBe(0n);
  });

  it("неправдоподобная величина -> null, а не мусор в заголовке", () => {
    expect(feesFromGrowth(1n << 60n, 1n << 200n, 0n)).toBeNull();
  });
});
