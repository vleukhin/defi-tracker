import { describe, expect, it } from "vitest";
import {
  getSqrtRatioAtTick,
  positionAmounts,
} from "@/lib/chains/uniswap-math";
import { buildLpRange } from "./lp-range";

/**
 * Диапазон CLMM-позиции. Главная ловушка — ориентация пары: порядок
 * token0/token1 задан адресами, и одна и та же по смыслу позиция у разных
 * пар приходит перевернутой.
 */
const WETH = { symbol: "WETH", decimals: 18 };
const USDC = { symbol: "USDC", decimals: 6 };

describe("buildLpRange", () => {
  it("стейбл идет в котировку: «USDC за WETH», а не наоборот", () => {
    const range = buildLpRange({
      tickLower: -202_000,
      tickUpper: -200_000,
      tick: -201_000,
      token0: WETH,
      token1: USDC,
    })!;

    expect(range.baseSymbol).toBe("WETH");
    expect(range.quoteSymbol).toBe("USDC");
    // Границы — сотни-тысячи долларов за эфир, а не доли эфира за доллар
    expect(range.lowerPrice!).toBeGreaterThan(1000);
    expect(range.upperPrice!).toBeGreaterThan(range.lowerPrice!);
    expect(range.currentPrice!).toBeGreaterThan(range.lowerPrice!);
    expect(range.currentPrice!).toBeLessThan(range.upperPrice!);
  });

  it("перевернутая пара (стейбл — token0) дает те же числа", () => {
    const straight = buildLpRange({
      tickLower: -202_000,
      tickUpper: -200_000,
      tick: -201_000,
      token0: WETH,
      token1: USDC,
    })!;
    // Тот же пул с обратным порядком токенов: тики меняют знак
    const flipped = buildLpRange({
      tickLower: 200_000,
      tickUpper: 202_000,
      tick: 201_000,
      token0: USDC,
      token1: WETH,
    })!;

    expect(flipped.baseSymbol).toBe("WETH");
    expect(flipped.quoteSymbol).toBe("USDC");
    expect(flipped.lowerPrice!).toBeCloseTo(straight.lowerPrice!, 6);
    expect(flipped.upperPrice!).toBeCloseTo(straight.upperPrice!, 6);
    expect(flipped.position!).toBeCloseTo(straight.position!, 9);
  });

  it("положение считается по тикам: середина диапазона — 0,5", () => {
    const range = buildLpRange({
      tickLower: -202_000,
      tickUpper: -200_000,
      tick: -201_000,
      token0: WETH,
      token1: USDC,
    })!;
    expect(range.position).toBeCloseTo(0.5, 9);
  });

  it("цена ниже диапазона: положение < 0 и отклонение со знаком минус", () => {
    const range = buildLpRange({
      tickLower: -202_000,
      tickUpper: -200_000,
      // Цена базового актива упала — тик пула ушел ниже нижней границы
      tick: -203_000,
      token0: WETH,
      token1: USDC,
    })!;

    expect(range.position!).toBeLessThan(0);
    expect(range.outsidePercent!).toBeLessThan(0);
    // 1000 тиков ниже — это примерно −9,5% цены
    expect(range.outsidePercent!).toBeCloseTo(-9.5, 0);
  });

  it("цена выше диапазона: положение > 1 и отклонение со знаком плюс", () => {
    const range = buildLpRange({
      tickLower: -202_000,
      tickUpper: -200_000,
      tick: -199_000,
      token0: WETH,
      token1: USDC,
    })!;

    expect(range.position!).toBeGreaterThan(1);
    expect(range.outsidePercent!).toBeGreaterThan(0);
  });

  it("у перевернутой пары стороны выхода не путаются местами", () => {
    // Цена WETH упала: у пары с USDC в token0 тик пула при этом РАСТЕТ
    const range = buildLpRange({
      tickLower: 200_000,
      tickUpper: 202_000,
      tick: 203_000,
      token0: USDC,
      token1: WETH,
    })!;
    expect(range.position!).toBeLessThan(0);
    expect(range.outsidePercent!).toBeLessThan(0);
  });

  it("тик не прочитан -> границы есть, цены и положения нет", () => {
    const range = buildLpRange({
      tickLower: -202_000,
      tickUpper: -200_000,
      tick: null,
      token0: WETH,
      token1: USDC,
    })!;
    expect(range.lowerPrice).not.toBeNull();
    expect(range.currentPrice).toBeNull();
    expect(range.position).toBeNull();
    expect(range.outsidePercent).toBeNull();
  });

  it("позиция на весь диапазон: границ в числах нет", () => {
    const range = buildLpRange({
      tickLower: -887_220,
      tickUpper: 887_220,
      tick: -201_000,
      token0: WETH,
      token1: USDC,
    })!;
    expect(range.lowerPrice).toBeNull();
    expect(range.upperPrice).toBeNull();
    expect(range.currentPrice).not.toBeNull();
  });

  it("мусорные границы -> null, а не перевернутая шкала", () => {
    expect(
      buildLpRange({
        tickLower: 0,
        tickUpper: 0,
        tick: 0,
        token0: WETH,
        token1: USDC,
      }),
    ).toBeNull();
  });
});

/**
 * Что окажется на руках при выходе. Развилка стратегии (docs/07 §5, §6):
 * вниз — позиция стала активом и уходит в Growth, вверх — стала стейблами
 * и диапазон перезаливают.
 */
describe("количества на границах", () => {
  const LIQUIDITY = "1234567890123456789";

  it("внизу остается базовый актив, вверху — котировка", () => {
    const range = buildLpRange({
      tickLower: -202_000,
      tickUpper: -200_000,
      tick: -201_000,
      liquidity: LIQUIDITY,
      token0: WETH,
      token1: USDC,
    })!;

    expect(range.exitLower!.symbol).toBe("WETH");
    expect(range.exitUpper!.symbol).toBe("USDC");
    expect(range.exitLower!.quantity).toBeGreaterThan(0);
    expect(range.exitUpper!.quantity).toBeGreaterThan(0);
  });

  it("количества сходятся с раскладкой позиции на самой границе", () => {
    const input = {
      tickLower: -202_000,
      tickUpper: -200_000,
      liquidity: LIQUIDITY,
      token0: WETH,
      token1: USDC,
    };
    const range = buildLpRange({ ...input, tick: -201_000 })!;
    // На нижней границе позиция целиком в token0 — то же число, что дает
    // общий расчет состава при цене на этой границе
    const atLower = positionAmounts(
      getSqrtRatioAtTick(input.tickLower),
      input.tickLower,
      input.tickUpper,
      BigInt(LIQUIDITY),
    );
    expect(range.exitLower!.quantity).toBeCloseTo(
      Number(atLower.amount0) / 1e18,
      9,
    );

    const atUpper = positionAmounts(
      getSqrtRatioAtTick(input.tickUpper),
      input.tickLower,
      input.tickUpper,
      BigInt(LIQUIDITY),
    );
    expect(range.exitUpper!.quantity).toBeCloseTo(
      Number(atUpper.amount1) / 1e6,
      6,
    );
  });

  it("перевернутая пара не путает актив с котировкой", () => {
    const range = buildLpRange({
      tickLower: 200_000,
      tickUpper: 202_000,
      tick: 201_000,
      liquidity: LIQUIDITY,
      token0: USDC,
      token1: WETH,
    })!;
    expect(range.exitLower!.symbol).toBe("WETH");
    expect(range.exitUpper!.symbol).toBe("USDC");
  });

  it("без ликвидности количеств нет, а диапазон остается", () => {
    const range = buildLpRange({
      tickLower: -202_000,
      tickUpper: -200_000,
      tick: -201_000,
      token0: WETH,
      token1: USDC,
    })!;
    expect(range.lowerPrice).not.toBeNull();
    expect(range.exitLower).toBeNull();
    expect(range.exitUpper).toBeNull();
  });

  it("на весь диапазон количеств нет: границы там без чисел", () => {
    const range = buildLpRange({
      tickLower: -887_220,
      tickUpper: 887_220,
      tick: -201_000,
      liquidity: LIQUIDITY,
      token0: WETH,
      token1: USDC,
    })!;
    expect(range.exitLower).toBeNull();
    expect(range.exitUpper).toBeNull();
  });
});
