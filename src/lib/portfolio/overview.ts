import type { PortfolioOverviewDto } from "@/lib/api/types";

/**
 * Связка пяти чисел (Фаза 4, S4.2). Чистая функция без I/O — вся
 * null-семантика тестируется офлайн.
 *
 * Методика (утверждена, docs/03-fazy-2-6.md):
 *   Чистая  = Активы − Долг
 *   Прибыль = Чистая − Внесено
 * «Внесено» — только собственные деньги извне; вычитание долга само
 * корректно обрабатывает любые случаи с плечом, происхождение отдельных
 * монет не отслеживается.
 *
 * Null-пропагация ЧЕСТНАЯ:
 *  * кошельков нет — on-chain долга быть не может: debtUsd = 0;
 *  * кошельки есть, а строк aave_account_health нет — долг ни разу
 *    не прочитан: debtUsd = null (не ноль!), netUsd/profitUsd = null;
 *  * есть строка с неизвестным долгом (total_debt_usd null) — суммарный
 *    долг неизвестен целиком: частичная сумма выглядела бы как маленький
 *    долг, а это ложь.
 */

/** Строка aave_account_health, сведенная к нужному полю. */
export interface HealthDebtInput {
  totalDebtUsd: number | null;
}

export interface OverviewInput {
  /** Итог портфеля (оценка CoinGecko). */
  assetsUsd: number;
  hasWallets: boolean;
  /** Все строки aave_account_health по кошелькам пользователя. */
  healthRows: HealthDebtInput[];
  /** Подписанная сумма журнала deposits. */
  depositedUsd: number;
}

export function computeOverview(input: OverviewInput): PortfolioOverviewDto {
  let debtUsd: number | null;
  if (!input.hasWallets) {
    debtUsd = 0;
  } else if (input.healthRows.length === 0) {
    debtUsd = null;
  } else if (input.healthRows.some((r) => r.totalDebtUsd === null)) {
    debtUsd = null;
  } else {
    debtUsd = input.healthRows.reduce((sum, r) => sum + r.totalDebtUsd!, 0);
  }

  const netUsd = debtUsd === null ? null : input.assetsUsd - debtUsd;
  const profitUsd = netUsd === null ? null : netUsd - input.depositedUsd;

  return {
    assetsUsd: input.assetsUsd,
    debtUsd,
    netUsd,
    depositedUsd: input.depositedUsd,
    profitUsd,
  };
}
