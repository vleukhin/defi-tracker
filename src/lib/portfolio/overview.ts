import type { PortfolioOverviewDto } from "@/lib/api/types";

/**
 * Связка пяти чисел (Фаза 4, S4.2). Чистая функция без I/O — вся
 * null-семантика тестируется офлайн.
 *
 * Методика (утверждена, docs/03-fazy-2-6.md):
 *   Активы  = портфель + размещенные позиции   (Фаза 5)
 *   Чистая  = Активы − Долг
 *   Прибыль = Чистая − Внесено
 * «Внесено» — только собственные деньги извне; вычитание долга само
 * корректно обрабатывает любые случаи с плечом, происхождение отдельных
 * монет не отслеживается.
 *
 * Оговорка к последнему утверждению, найденная в Фазе 5: оно верно ТОЛЬКО
 * когда Активы содержат все, во что превратились заемные деньги. До Фазы 5
 * позиции в пулах и на Fluid в Активы не входили, и Чистая была занижена
 * ровно на размещенную заемную сумму.
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
  /** Итог трех категорий портфеля — только собственные средства. */
  portfolioUsd: number;
  /**
   * Размещенные позиции Фазы 5 (Fluid после неттинга + GM + LP).
   * null = стоимость части позиций неизвестна. Пустой список дает 0:
   * «позиций нет» — честный ноль, в отличие от «долг ни разу не прочитан».
   */
  positionsUsd: number | null;
  hasWallets: boolean;
  /** Все строки aave_account_health по кошелькам пользователя. */
  healthRows: HealthDebtInput[];
  /** Подписанная сумма журнала deposits. */
  depositedUsd: number;
  /**
   * Свободные ЗАЕМНЫЕ средства на кошельках (Фаза 7).
   *
   * Отдельное слагаемое, потому что в три категории они не входят: портфель
   * ведется по собственным средствам. В Активы входить обязаны — иначе
   * повторилась бы ошибка Фазы 5: Долг вычитается целиком, и Чистая была бы
   * занижена ровно на сумму занятых, но еще не размещенных денег.
   *
   * Не nullable: заемный баланс без цены дает warning в строке категории,
   * а не делает Активы неизвестными — тот же прием, что у залога.
   */
  freeBorrowedUsd?: number;
}

/*
 * Три шага формулы вынесены наружу, чтобы история Прибыли (profit-series.ts)
 * считала ее ТЕМ ЖЕ кодом, а не своей копией: разойдясь, график и число
 * в шапке противоречили бы друг другу, и понять, кто из них врет, было бы
 * нечем. Разница входов только в свободных заемных: здесь их отсутствие —
 * это ноль (баланс без цены дает warning в строке категории, сеть можно
 * перечитать сейчас), в истории — null, потому что прошлую дату перечитать
 * нельзя.
 */

/** Активы = портфель + размещенные позиции + свободные заемные (Фазы 5 и 7). */
export function assetsUsdOf(
  portfolioUsd: number,
  positionsUsd: number | null,
  freeBorrowedUsd: number | null,
): number | null {
  if (positionsUsd === null || freeBorrowedUsd === null) return null;
  return portfolioUsd + positionsUsd + freeBorrowedUsd;
}

/** Чистая = Активы − Долг. */
export function netUsdOf(
  assetsUsd: number | null,
  debtUsd: number | null,
): number | null {
  return assetsUsd === null || debtUsd === null ? null : assetsUsd - debtUsd;
}

/** Прибыль = Чистая − Внесено. */
export function profitUsdOf(
  netUsd: number | null,
  depositedUsd: number,
): number | null {
  return netUsd === null ? null : netUsd - depositedUsd;
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

  // Активы = портфель + размещенные позиции (Фаза 5). Считать Активы одним
  // портфелем нельзя: заемные деньги, ушедшие в пул, из Активов выпадали бы,
  // а Долг вычитался целиком — Чистая занижалась ровно на эту сумму.
  const freeBorrowedUsd = input.freeBorrowedUsd ?? 0;
  const assetsUsd = assetsUsdOf(
    input.portfolioUsd,
    input.positionsUsd,
    freeBorrowedUsd,
  );

  const netUsd = netUsdOf(assetsUsd, debtUsd);
  const profitUsd = profitUsdOf(netUsd, input.depositedUsd);

  return {
    assetsUsd,
    portfolioUsd: input.portfolioUsd,
    positionsUsd: input.positionsUsd,
    freeBorrowedUsd,
    debtUsd,
    netUsd,
    depositedUsd: input.depositedUsd,
    profitUsd,
  };
}
