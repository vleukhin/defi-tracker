import type { StableBorrowRateDto } from "@/lib/api/types";

/**
 * Стоимость заемных стейблов одним числом — порог для ставок Yield-позиций
 * (docs/07 §3: депозит на стороннем лендинге держат, только пока его ставка
 * выше ставки по займу).
 *
 * Чистая функция без I/O: сборщик портфеля отдает сюда долг по резервам,
 * прочитанный читателем Aave.
 *
 * Среднее — ВЗВЕШЕННОЕ по размеру долга, а не простое: 30 000 под 6% и
 * 1 000 под 12% стоят 6,2% годовых, а не 9%. Простое среднее позволило бы
 * копеечному резерву перевесить основной заем и сделать вывод «депозит
 * невыгоден» на пустом месте.
 *
 * Резервы без прочитанной ставки в среднее не входят, но в долг входят:
 * иначе на экране появилось бы число, которое не про весь заем.
 */
export interface StableBorrowReserveInput {
  chain: string;
  symbol: string;
  /** Долг по резерву в долларах. */
  debtUsd: number;
  /** Ставка на момент чтения, % годовых; null = не прочитана. */
  ratePercent: number | null;
}

export function buildStableBorrow(
  reserves: StableBorrowReserveInput[],
): StableBorrowRateDto {
  const alive = reserves.filter((r) => r.debtUsd > 0);

  let weightedSum = 0;
  let ratedDebt = 0;
  let debtUsd = 0;
  for (const r of alive) {
    debtUsd += r.debtUsd;
    if (r.ratePercent === null) continue;
    weightedSum += r.ratePercent * r.debtUsd;
    ratedDebt += r.debtUsd;
  }

  return {
    ratePercent: ratedDebt > 0 ? weightedSum / ratedDebt : null,
    debtUsd,
    reserves: alive
      .slice()
      .sort((a, b) => b.debtUsd - a.debtUsd)
      .map((r) => ({
        chain: r.chain,
        symbol: r.symbol,
        debtUsd: r.debtUsd,
        ratePercent: r.ratePercent,
      })),
  };
}
