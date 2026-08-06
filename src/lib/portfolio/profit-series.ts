import type { DepositDto, SnapshotDto } from "@/lib/api/types";
import { assetsUsdOf, netUsdOf, profitUsdOf } from "./overview";

/**
 * История Прибыли по снепшотам: Чистая (Активы − Долг) минус Внесено
 * на каждую дату. Чистые функции без I/O — рядом с overview.ts, который
 * считает то же самое на сегодняшний день.
 *
 * ФОРМУЛА НЕ ДУБЛИРУЕТСЯ: assetsUsdOf/netUsdOf/profitUsdOf берутся из
 * overview.ts. Своя копия арифметики рано или поздно разошлась бы с числом
 * в шапке Портфеля, и понять, кто из двух прав, было бы нечем.
 *
 * «ВНЕСЕНО» НЕ ИЗ СНЕПШОТА, А РЕПЛЕЕМ ЖУРНАЛА. Так решено еще в миграции
 * 20260730000090: журнал deposits хранит happened_on, сумма на любую дату
 * восстановима, а снепшотится только невосстановимое. Колонка в снепшоте
 * разошлась бы с журналом после первой же правки старой записи.
 *
 * ТОЧКА БЕЗ ВЕЛИЧИНЫ ВЫБРАСЫВАЕТСЯ ИЗ СЕРИИ ЦЕЛИКОМ — как день без
 * количества в quantitySeries. Неизвестный долг, неизвестная стоимость
 * позиций и непрочитанные свободные заемные делают Прибыль точки
 * неизвестной, а не нулевой; нарисовать ее нулем значило бы показать
 * просадку, которой не было.
 */

export interface ProfitPoint {
  /** Календарный день UTC, YYYY-MM-DD. */
  takenOn: string;
  /** Портфель + позиции + свободные заемные на эту дату. */
  assetsUsd: number;
  debtUsd: number;
  netUsd: number;
  /** Внесено на конец дня — реплеем журнала, а не из снепшота. */
  depositedUsd: number;
  /** Знаковая величина: убыток — отрицательная. */
  profitUsd: number;
  /** Снепшот помечен частичным — точку нужно пометить и на графике. */
  isPartial: boolean;
}

/** Запись журнала в объеме, нужном для реплея. */
export type DepositEntry = Pick<DepositDto, "amount" | "happenedOn">;

/**
 * Подписанная сумма журнала по день `day` ВКЛЮЧИТЕЛЬНО.
 *
 * Граница включительная осознанно. Журнал дневной, а снепшот снимается
 * в 03:00 UTC — депозит, заведенный позже в тот же день, попадает во
 * «Внесено» раньше, чем в балансы, и дает провал Прибыли ровно на сумму
 * депозита на один день. Исключительная граница меняла бы этот провал
 * на такой же скачок при нажатии «Снепшот сейчас» и вдобавок расходилась бы
 * с числом «Прибыль» в шапке Портфеля, которое суммирует ВЕСЬ журнал.
 * Согласие с числом, которое уже на экране, важнее однодневного артефакта.
 */
export function depositedAsOf(
  deposits: readonly DepositEntry[],
  day: string,
): number {
  let sum = 0;
  for (const deposit of deposits) {
    if (deposit.happenedOn <= day) sum += Number(deposit.amount);
  }
  return sum;
}

/**
 * Серия Прибыли. Снепшоты приходят по возрастанию takenOn (так их отдает
 * GET /api/snapshots), журнал сортируется здесь — порядок его выдачи
 * обратный, и полагаться на него нельзя.
 *
 * Обе последовательности проходятся одним указателем: пересчитывать сумму
 * журнала на каждой точке — это n×m на годовом периоде.
 */
export function profitSeries(
  snapshots: readonly SnapshotDto[],
  deposits: readonly DepositEntry[],
): ProfitPoint[] {
  const journal = [...deposits].sort((a, b) =>
    a.happenedOn < b.happenedOn ? -1 : a.happenedOn > b.happenedOn ? 1 : 0,
  );

  const points: ProfitPoint[] = [];
  let cursor = 0;
  let deposited = 0;

  for (const snapshot of snapshots) {
    // Включительно: см. depositedAsOf
    while (
      cursor < journal.length &&
      journal[cursor].happenedOn <= snapshot.takenOn
    ) {
      deposited += Number(journal[cursor].amount);
      cursor += 1;
    }

    const assetsUsd = assetsUsdOf(
      snapshot.totalUsd,
      snapshot.positionsUsd,
      snapshot.freeBorrowedUsd,
    );
    const netUsd = netUsdOf(assetsUsd, snapshot.debtUsd);
    const profitUsd = profitUsdOf(netUsd, deposited);
    if (
      assetsUsd === null ||
      netUsd === null ||
      profitUsd === null ||
      !Number.isFinite(profitUsd)
    ) {
      continue;
    }

    points.push({
      takenOn: snapshot.takenOn,
      assetsUsd,
      // netUsd не null ⇒ и долг был известен
      debtUsd: snapshot.debtUsd!,
      netUsd,
      depositedUsd: deposited,
      profitUsd,
      isPartial: snapshot.isPartial,
    });
  }

  return points;
}

/** Изменение Прибыли за период: первая → последняя ПОСЧИТАННАЯ точка. */
export interface ProfitChange {
  from: number;
  to: number;
  /** Абсолютное изменение в долларах. */
  abs: number;
}

/**
 * Изменение за период — только в долларах, без процентов. База знакопеременная:
 * переход −2 000 → +3 000 дал бы «−250 %», а это не рост и не падение,
 * а бессмыслица. По той же причине не переиспользуется periodDelta —
 * он вдобавок ничего не знает о журнале депозитов.
 */
export function profitChange(
  points: readonly ProfitPoint[],
): ProfitChange | null {
  if (points.length < 2) return null;
  const from = points[0].profitUsd;
  const to = points[points.length - 1].profitUsd;
  return { from, to, abs: to - from };
}
