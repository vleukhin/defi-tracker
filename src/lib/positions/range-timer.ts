/**
 * Правило 48 часов для CLMM-позиции, вышедшей из диапазона (docs/07 §5–§7).
 *
 * Стратегия не велит действовать сразу: цена должна «закрепиться». Ждут около
 * 48 часов, а если срок выпадает на выходные — до понедельника. Без этого
 * счета выход из диапазона выглядел бы как повод дергаться немедленно,
 * а именно от этого правило и защищает.
 *
 * Чистая функция без I/O: «сейчас» передается снаружи.
 *
 * Выходные считаются по UTC — как и все даты в проекте. На часовых поясах
 * ближе к линии перемены дат граница суток сместится на несколько часов;
 * для правила «переждать выходные» это несущественно, а альтернатива —
 * тащить в расчет часовой пояс пользователя, которого у нас нет.
 */

const HOUR_MS = 3_600_000;
export const RANGE_WAIT_HOURS = 48;

export interface RangeDecision {
  /** Сколько часов прошло с момента выхода из диапазона. */
  hoursElapsed: number;
  /**
   * Сколько часов ждать еще; 0 = срок вышел. Считается от СРОКА, а не как
   * «48 минус прошедшие»: сдвинутый с выходных срок иначе давал бы
   * отрицательный остаток при формально истекших 48 часах.
   */
  hoursLeft: number;
  /** Момент, с которого по стратегии можно действовать (ISO). */
  readyAtIso: string;
  /** Сроки вышли: 48 часов прошли и это не выходной. */
  ready: boolean;
  /** Ожидание продлено с выходных до понедельника. */
  postponedToMonday: boolean;
}

export function rangeDecision(
  outOfRangeSinceIso: string,
  nowMs: number,
): RangeDecision | null {
  const since = Date.parse(outOfRangeSinceIso);
  if (Number.isNaN(since)) return null;

  const plain = since + RANGE_WAIT_HOURS * HOUR_MS;
  const readyAt = nextBusinessMoment(plain);

  return {
    hoursElapsed: Math.max(0, (nowMs - since) / HOUR_MS),
    hoursLeft: Math.max(0, (readyAt - nowMs) / HOUR_MS),
    readyAtIso: new Date(readyAt).toISOString(),
    ready: nowMs >= readyAt,
    postponedToMonday: readyAt !== plain,
  };
}

/**
 * Суббота и воскресенье сдвигаются на понедельник, 00:00 UTC: «если выходные,
 * ждать до понедельника». Раньше понедельника решение по стратегии не
 * принимается, даже если 48 часов формально прошли.
 */
function nextBusinessMoment(ms: number): number {
  const date = new Date(ms);
  const day = date.getUTCDay(); // 0 — воскресенье, 6 — суббота
  if (day !== 0 && day !== 6) return ms;

  const monday = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + (day === 6 ? 2 : 1),
  );
  return monday;
}
