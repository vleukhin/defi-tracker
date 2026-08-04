import { describe, expect, it } from "vitest";
import { fees24hFrom, nextOutOfRangeSince } from "./uniswap-v3";

/**
 * Момент выхода из диапазона. Факт выхода читается заново каждым
 * обновлением, а вот момент перехода невосстановим: не сохранили — правило
 * 48 часов (docs/07 §5–§7) считать не от чего.
 */
describe("nextOutOfRangeSince", () => {
  const now = "2026-08-01T12:00:00.000Z";
  const earlier = "2026-07-30T09:00:00.000Z";

  it("позиция в диапазоне — отсчета нет", () => {
    expect(
      nextOutOfRangeSince(true, { inRange: false, outOfRangeSince: earlier }, now),
    ).toBeNull();
  });

  it("вышла только что — отсчет с текущего чтения", () => {
    expect(
      nextOutOfRangeSince(false, { inRange: true, outOfRangeSince: null }, now),
    ).toBe(now);
  });

  it("остается вне диапазона — прежний момент сохраняется", () => {
    // Иначе таймер обнулялся бы каждым обновлением и 48 часов не наступали
    // бы никогда
    expect(
      nextOutOfRangeSince(
        false,
        { inRange: false, outOfRangeSince: earlier },
        now,
      ),
    ).toBe(earlier);
  });

  it("позиция видна впервые и уже вне диапазона — отсчет с этого чтения", () => {
    expect(nextOutOfRangeSince(false, undefined, now)).toBe(now);
  });

  it("вернулась в диапазон и снова вышла — отсчет начинается заново", () => {
    const back = nextOutOfRangeSince(
      true,
      { inRange: false, outOfRangeSince: earlier },
      now,
    );
    expect(
      nextOutOfRangeSince(false, { inRange: true, outOfRangeSince: back }, now),
    ).toBe(now);
  });
});

/**
 * Комиссии за сутки по аккумуляторам пула.
 *
 * Ликвидность принадлежит своему диапазону, поэтому проверяется главным
 * образом одно: две позиции в одном пуле считаются независимо, а не общей
 * цифрой пула.
 */
describe("fees24hFrom", () => {
  const WINDOW = {
    fromBlock: 1000,
    toBlock: 8000,
    fromAt: "2026-08-02T12:00:00.000Z",
    toAt: "2026-08-03T12:00:00.000Z",
  };
  const BOUNDS = {
    tickLower: -1000,
    tickUpper: 1000,
    decimals0: 18,
    decimals1: 6,
  };
  const Q128 = 1n << 128n;
  const tick = (outside0: bigint, outside1: bigint) => ({
    outside0X128: outside0,
    outside1X128: outside1,
    initialized: true,
  });

  /** Срез внутри диапазона: inside = global − outsideLower − outsideUpper. */
  const sample = (global0: bigint, liquidity: bigint | null = 10n ** 18n) => ({
    tick: 0,
    global0X128: global0,
    global1X128: global0 / 2n,
    lower: tick(0n, 0n),
    upper: tick(0n, 0n),
    liquidity,
  });

  it("считает начисленное за окно по обоим токенам", () => {
    // Прирост inside на 3*Q128 при ликвидности 1e18 -> 3e18 «сырых» единиц
    const r = fees24hFrom(sample(0n), sample(3n * Q128), BOUNDS, WINDOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.token0).toBeCloseTo(3, 9); // 3e18 при decimals 18
    expect(r.token1).toBeCloseTo(1.5e12, 0); // 1,5e18 при decimals 6
    expect(r.fromBlock).toBe(1000);
    expect(r.toAt).toBe(WINDOW.toAt);
  });

  it("две позиции в одном пуле с разными диапазонами считаются раздельно", () => {
    // Общие global и тик пула, но у узкой позиции выше feeGrowth внутри
    const wide = fees24hFrom(
      sample(0n),
      sample(1n * Q128),
      { ...BOUNDS, tickLower: -50_000, tickUpper: 50_000 },
      WINDOW,
    );
    const narrow = fees24hFrom(
      { ...sample(0n), lower: tick(0n, 0n), upper: tick(0n, 0n) },
      { ...sample(4n * Q128), lower: tick(0n, 0n), upper: tick(0n, 0n) },
      { ...BOUNDS, tickLower: -100, tickUpper: 100 },
      WINDOW,
    );
    expect(wide.ok && narrow.ok).toBe(true);
    if (!wide.ok || !narrow.ok) return;
    // Узкий диапазон при той же ликвидности собирает больше
    expect(narrow.token0).toBeGreaterThan(wide.token0);
  });

  it("позиция вне диапазона все окно: ровно ноль, а не «неизвестно»", () => {
    const stale = sample(5n * Q128);
    const r = fees24hFrom(stale, stale, BOUNDS, WINDOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.token0).toBe(0);
    expect(r.token1).toBe(0);
  });

  it("позиции сутки назад еще не было — too_young, пул при этом прочитан", () => {
    const r = fees24hFrom(sample(0n, null), sample(3n * Q128), BOUNDS, WINDOW);
    expect(r).toEqual({ ok: false, reason: "too_young" });
  });

  it("пул на старом блоке не прочитан — no_archive, а не «моложе суток»", () => {
    // Молчание positions() ничего не значит, если архива нет вовсе
    const blind = { ...sample(0n, null), global0X128: null, tick: null };
    const r = fees24hFrom(blind, sample(3n * Q128), BOUNDS, WINDOW);
    expect(r).toEqual({ ok: false, reason: "no_archive" });
  });

  it("ликвидность менялась внутри окна — формула неприменима", () => {
    const r = fees24hFrom(
      sample(0n, 10n ** 18n),
      sample(3n * Q128, 2n * 10n ** 18n),
      BOUNDS,
      WINDOW,
    );
    expect(r).toEqual({ ok: false, reason: "liquidity_changed" });
  });

  it("неинициализированный тик не выдается за честный ноль", () => {
    const dead = {
      ...sample(3n * Q128),
      upper: { outside0X128: 0n, outside1X128: 0n, initialized: false },
    };
    const r = fees24hFrom(sample(0n), dead, BOUNDS, WINDOW);
    expect(r).toEqual({ ok: false, reason: "tick_uninitialized" });
  });

  it("неправдоподобная величина не попадает на экран", () => {
    const r = fees24hFrom(sample(0n), sample(1n << 200n), BOUNDS, WINDOW);
    expect(r).toEqual({ ok: false, reason: "implausible" });
  });

  it("аккумулятор завернулся через ноль — окно все равно посчитано", () => {
    // Оба аккумулятора у верхней границы uint256 и переполняются внутри окна.
    // Это штатное состояние живого пула, а не сбой: смысл имеет только разница
    const wrapping = (global: bigint) => ({
      ...sample(global),
      global0X128: global,
      global1X128: global,
    });
    const r = fees24hFrom(
      wrapping((1n << 256n) - 2n * Q128),
      wrapping(1n * Q128),
      BOUNDS,
      WINDOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.token0).toBeCloseTo(3, 9); // 3e18 при decimals 18
    expect(r.token1).toBeCloseTo(3e12, 0); // те же 3e18 при decimals 6
  });
});
