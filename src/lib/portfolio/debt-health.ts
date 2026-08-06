/**
 * Сведение строк aave_account_health к двум числам снепшота: залог и
 * минимальный health factor. Чистая функция без I/O — рядом с overview.ts,
 * который тем же набором строк считает Долг.
 *
 * Правила ровно те же, что на экране «Долг» (lib/api/debt.ts), и это
 * не совпадение: точка истории обязана совпадать с числом, которое в тот
 * день показывал экран.
 *
 *  * Залог — сумма с null-пропагацией: неизвестное слагаемое делает
 *    неизвестной всю сумму. Частичная сумма выглядела бы как маленький
 *    залог, а это завышенный LTV — то есть ложная тревога.
 *  * HF — МИНИМУМ по (кошелек, сеть), а не среднее и не пересчет из сумм:
 *    ликвидация приходит к худшей позиции, а не к портфелю в среднем.
 */

export interface DebtHealthRow {
  totalCollateralUsd: number | null;
  totalDebtUsd: number | null;
  /** null = долга на этой паре (кошелек, сеть) нет («∞»). */
  healthFactor: number | null;
}

export interface DebtHealthSummary {
  /** null = здоровье ни разу не читалось (не «залога нет»). */
  collateralUsd: number | null;
  /**
   * null = либо долга нет вовсе («∞»), либо не читалось. Различает эти два
   * случая соседний Долг: 0 — долга не было, null — не читалось. Ровно так
   * же двузначен NULL в aave_account_health.health_factor.
   */
  minHealthFactor: number | null;
}

export function summarizeDebtHealth(
  rows: readonly DebtHealthRow[],
  hasWallets: boolean,
): DebtHealthSummary {
  // Кошельков нет — on-chain залога быть не может: честный ноль, как у Долга
  if (!hasWallets) return { collateralUsd: 0, minHealthFactor: null };
  if (rows.length === 0) return { collateralUsd: null, minHealthFactor: null };

  let collateralUsd: number | null = 0;
  for (const row of rows) {
    if (row.totalCollateralUsd === null) {
      collateralUsd = null;
      break;
    }
    collateralUsd += row.totalCollateralUsd;
  }

  const hfs = rows
    .map((r) => r.healthFactor)
    .filter((hf): hf is number => hf !== null);

  return {
    collateralUsd,
    minHealthFactor: hfs.length > 0 ? Math.min(...hfs) : null,
  };
}
