/**
 * Журнал «Внесено» (Фаза 4, S4.0): пользователь вводит положительную сумму
 * и выбирает направление переключателем «Пополнение / Вывод» — минус руками
 * не набирается. API принимает ПОДПИСАННУЮ десятичную строку: вывод
 * собственных средств — отрицательная запись, уменьшающая «Внесено».
 */

export type DepositDirection = "in" | "out";

/**
 * Сумма из формы в подписанную строку для API. null — невалидный ввод
 * (не число, ноль, отрицательное): форма показывает инлайн-ошибку.
 * Запятая толерантно заменяется на точку, как во всех формах приложения.
 */
export function signedDepositAmount(
  direction: DepositDirection,
  raw: string,
): string | null {
  const cleaned = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  if (Number.parseFloat(cleaned) === 0) return null;
  return direction === "out" ? `-${cleaned}` : cleaned;
}
