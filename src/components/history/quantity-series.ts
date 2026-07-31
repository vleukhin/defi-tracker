/**
 * Серии количеств монет для графиков истории (S3.1: «для стратегии
 * накопления динамика количества монет важнее кривой стоимости»).
 * Чистые функции без DOM — рядом с chart-geometry.ts.
 *
 * Ключевое правило: `quantity === null` означает «цены категории в тот день
 * не было, эквивалент не выведен», а НЕ ноль. Такой день выбрасывается
 * из серии целиком: день без количества перестает быть соседним по
 * календарю, и splitRuns рвет линию сам — ровно как на пропущенном дне.
 * Нарисовать null нулем значило бы показать накопителю «я всё продал».
 */

import type { PortfolioCategory, SnapshotDto } from "@/lib/api/types";
import type { ValueAxis } from "./chart-geometry";

export interface QuantityPoint {
  /** Календарный день UTC, YYYY-MM-DD. */
  takenOn: string;
  /** Количество в единицах категории: BTC / ETH / USD. Никогда не null. */
  quantity: number;
  /** Снепшот помечен как частичный — точку нужно пометить и на графике. */
  isPartial: boolean;
}

/**
 * Точность количеств: монеты — 4 знака (как в таблице портфеля),
 * стейблы — целые доллары (4 знака у $39 548 были бы шумом).
 */
export const QUANTITY_DECIMALS: Record<PortfolioCategory, number> = {
  btc: 4,
  eth: 4,
  stable: 0,
};

/**
 * Серия количеств категории. Дни без количества (нет цены) и снепшоты
 * без этой категории в составе не попадают в серию вовсе — не нулями.
 */
export function quantitySeries(
  snapshots: readonly SnapshotDto[],
  category: PortfolioCategory,
): QuantityPoint[] {
  const points: QuantityPoint[] = [];
  for (const snapshot of snapshots) {
    const item = snapshot.items.find((i) => i.category === category);
    const quantity = item?.quantity;
    if (quantity === null || quantity === undefined) continue;
    if (!Number.isFinite(quantity)) continue;
    points.push({
      takenOn: snapshot.takenOn,
      quantity,
      isPartial: snapshot.isPartial,
    });
  }
  return points;
}

/** Изменение количества за период: первая → последняя точка С количеством. */
export interface QuantityChange {
  from: number;
  to: number;
  /** Абсолютное изменение, в единицах категории. */
  abs: number;
  /** Относительное изменение в процентах; null — стартовали с нуля. */
  pct: number | null;
}

/**
 * Изменение за период. Ведущие и хвостовые null уже отфильтрованы
 * quantitySeries, поэтому «первая» и «последняя» — реальные измерения,
 * а не дни, в которые количество не выводилось.
 */
export function periodChange(
  points: readonly QuantityPoint[],
): QuantityChange | null {
  if (points.length < 2) return null;
  const from = points[0].quantity;
  const to = points[points.length - 1].quantity;
  const abs = to - from;
  return { from, to, abs, pct: from === 0 ? null : (abs / from) * 100 };
}

/** Сколько знаков после запятой в записи числа («0,25» → 2, «1e-7» → 7). */
function decimalsOf(value: number): number {
  const text = String(value);
  const exponent = text.indexOf("e-");
  if (exponent !== -1) {
    const mantissa = plainDecimals(text.slice(0, exponent));
    return mantissa + Number(text.slice(exponent + 2));
  }
  return plainDecimals(text);
}

function plainDecimals(text: string): number {
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Точность подписей оси Y. Базовая точность категории — минимум, но если
 * шаг сетки мельче (стейблы с шагом 2,5), знаков берется столько, сколько
 * нужно самому шагу: иначе три подписи подряд читались бы как «39 548».
 */
export function tickDecimals(axis: ValueAxis, base: number): number {
  const needed = axis.ticks.reduce(
    (max, tick) => Math.max(max, decimalsOf(tick)),
    0,
  );
  return Math.min(8, Math.max(base, needed));
}
