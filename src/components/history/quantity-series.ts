/**
 * Серии количеств монет для графиков истории (S3.1: «для стратегии
 * накопления динамика количества монет важнее кривой стоимости»).
 * Чистые функции без DOM — рядом с chart-geometry.ts.
 *
 * Количество берется СЧЁТЧИКОМ МОНЕТ из сырого состава точки (`coinCount`),
 * а не полем `quantity`: последнее — стоимость, делённая на цену категории,
 * и ползло на 0,1–0,3% в день от одного движения цен. График накопления,
 * который шевелится сам по себе, не отвечает на вопрос, ради которого
 * существует. Обоснование правила сложения — в lib/portfolio/coin-count.ts.
 *
 * Ключевое правило: отсутствие количества означает «состава в тот день нет»,
 * а НЕ ноль. Такой день выбрасывается из серии целиком: он перестает быть
 * соседним по календарю, и график рвет линию сам — ровно как на пропущенном
 * дне. Нарисовать null нулем значило бы показать накопителю «я всё продал».
 */

import { coinCount } from "@/lib/portfolio/coin-count";
import type { PortfolioCategory, SnapshotDto } from "@/lib/api/types";
import type { ValueAxis } from "./chart-geometry";

export interface QuantityPoint {
  /** Календарный день UTC, YYYY-MM-DD. */
  takenOn: string;
  /** Счётчик монет категории: BTC / ETH / USD. Никогда не null. */
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
 * Серия количеств категории. Дни без состава и снепшоты без этой категории
 * не попадают в серию вовсе — не нулями.
 *
 * На старый `quantity` при отсутствии состава мы НЕ откатываемся: это
 * другая величина (эквивалент по цене), и подмешать её в ряд значило бы
 * нарисовать ступеньку на границе эпох, которой в портфеле не было.
 * Пропущенные дни честно считает ChartNote («дни без количества»).
 */
export function quantitySeries(
  snapshots: readonly SnapshotDto[],
  category: PortfolioCategory,
): QuantityPoint[] {
  const points: QuantityPoint[] = [];
  for (const snapshot of snapshots) {
    const item = snapshot.items.find((i) => i.category === category);
    if (!item) continue;
    const quantity = coinCount(item.composition);
    if (quantity === null) continue;
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
