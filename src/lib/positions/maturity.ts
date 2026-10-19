/**
 * Погашение токена Pendle — единственный срок в портфеле, который известен
 * заранее и не зависит от рынка.
 *
 * К дате погашения PT превращается в базовый актив 1:1, YT перестает
 * начислять доход и стоит ноль, а LP остается половиной в уже погашенном
 * PT. Ни один из трех сам по себе дальше не работает: деньги лежат, пока
 * владелец их не заберет и не решит, в какую зону они идут. Поэтому срок
 * виден заранее (за MATURITY_SOON_DAYS) и громко после.
 *
 * Чистая функция без I/O: «сейчас» передается снаружи. Даты — UTC, как
 * везде в проекте; Pendle сам погашает в 00:00 UTC.
 */

const DAY_MS = 86_400_000;

/**
 * За сколько дней предупреждать. Неделя — горизонт, на котором PT уже
 * почти равен активу (дисконт сжат до долей процента), и решение о
 * следующем размещении пора принимать, а не откладывать до погашения.
 */
export const MATURITY_SOON_DAYS = 7;

export interface MaturityDecision {
  /**
   * Полных дней до погашения, округление вверх: «осталось 0,3 дня» —
   * это «1 день», а не «0» и не «сегодня уже погашено». После погашения 0.
   */
  daysLeft: number;
  /** Сколько дней прошло после погашения; 0 — еще не погашен. */
  daysSince: number;
  /** Срок наступил: токен можно забирать. */
  matured: boolean;
  /** До погашения не больше MATURITY_SOON_DAYS. */
  soon: boolean;
}

export function maturityDecision(
  expiryIso: string,
  nowMs: number,
): MaturityDecision | null {
  const expiry = Date.parse(expiryIso);
  if (Number.isNaN(expiry)) return null;

  const leftMs = expiry - nowMs;
  const matured = leftMs <= 0;
  const daysLeft = matured ? 0 : Math.ceil(leftMs / DAY_MS);
  return {
    daysLeft,
    daysSince: matured ? Math.floor((nowMs - expiry) / DAY_MS) : 0,
    matured,
    soon: !matured && daysLeft <= MATURITY_SOON_DAYS,
  };
}
