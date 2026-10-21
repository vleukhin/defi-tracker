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

export interface MaturityProgress {
  /** Пройденная доля срока, 0…1; после погашения ровно 1. */
  fraction: number;
  /** Полных дней с начала шкалы. */
  elapsedDays: number;
  /** Весь срок от начала шкалы до погашения, дней (к ближайшему). */
  totalDays: number;
}

/**
 * Где мы на пути от покупки к погашению.
 *
 * Начало шкалы — дата покупки (held-since.ts): шкала отвечает на вопрос
 * владельца «сколько из МОЕГО срока прошло», а не «сколько прожил рынок».
 * Купленный за неделю до погашения PT иначе выглядел бы почти пройденным
 * в день покупки.
 */
export function maturityProgress(
  startIso: string | null,
  expiryIso: string,
  nowMs: number,
): MaturityProgress | null {
  if (startIso === null) return null;
  const start = Date.parse(startIso);
  const expiry = Date.parse(expiryIso);
  if (Number.isNaN(start) || Number.isNaN(expiry) || expiry <= start) {
    return null;
  }
  const fraction = Math.min(1, Math.max(0, (nowMs - start) / (expiry - start)));
  return {
    fraction,
    elapsedDays: Math.max(0, Math.floor((Math.min(nowMs, expiry) - start) / DAY_MS)),
    totalDays: Math.round((expiry - start) / DAY_MS),
  };
}
