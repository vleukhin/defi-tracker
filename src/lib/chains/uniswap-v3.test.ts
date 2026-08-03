import { describe, expect, it } from "vitest";
import { nextOutOfRangeSince } from "./uniswap-v3";

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
