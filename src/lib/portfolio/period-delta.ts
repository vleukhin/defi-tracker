import type { SnapshotDto } from "@/lib/api/types";

/**
 * Изменение за окно снепшотов — одна функция на все экраны.
 *
 * Раньше эту величину считали в трёх местах по двум формулам, и две из них
 * стояли на одном экране «Портфеля» в двухстах пикселях друг от друга под
 * одинаковой подписью «за 30 дней»: hero сравнивал активы вместе с
 * позициями, карточка «Динамика стоимости» — только портфель. Числа не
 * совпадали, и понять, какое из них про что, было нельзя.
 *
 * Формулы обе верные — они отвечают на разные вопросы. Поэтому вопрос
 * выбирается явно (`basis`), а подписи разведены словами: PORTFOLIO_LABEL
 * и ASSETS_LABEL ниже.
 */

/**
 * Что сравнивается на концах окна.
 *
 * `portfolio` — только `totalUsd`: то, что рисует график стоимости.
 * `assets` — портфель плюс размещённые позиции. Если позиции неизвестны
 * хотя бы на одном конце, сравнение падает обратно на портфель: иначе
 * переезд капитала в позицию выглядел бы доходом, а выход из неё — убытком.
 */
export type DeltaBasis = "portfolio" | "assets";

export interface PeriodDelta {
  absolute: number;
  /** null = на старте был ноль, рост в процентах не определён. */
  percent: number | null;
}

/** Подпись дельты портфеля. Единица периода подставляется вызывающим. */
export const PORTFOLIO_DELTA_LABEL = "портфель за 30 дней";
/** Подпись дельты активов: она включает размещённые позиции. */
export const ASSETS_DELTA_LABEL = "активы за 30 дней";

function pointValue(snapshot: SnapshotDto, withPositions: boolean): number {
  return snapshot.totalUsd + (withPositions ? (snapshot.positionsUsd ?? 0) : 0);
}

/** null = сравнивать не с чем: одной точки для дельты не хватает. */
export function periodDelta(
  snapshots: SnapshotDto[],
  basis: DeltaBasis,
): PeriodDelta | null {
  if (snapshots.length < 2) return null;

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];

  const withPositions =
    basis === "assets" &&
    first.positionsUsd !== null &&
    last.positionsUsd !== null;

  const from = pointValue(first, withPositions);
  const to = pointValue(last, withPositions);
  const absolute = to - from;

  return {
    absolute,
    percent: from === 0 ? null : (absolute / from) * 100,
  };
}
