import type { SnapshotDto } from "@/lib/api/types";

/**
 * Серии риска по снепшотам: health factor и LTV. Чистые функции без DOM —
 * тот же приём, что у quantity-series для количеств монет.
 *
 * ОБЩЕЕ ПРАВИЛО: точка, величина которой в тот день не была известна,
 * из серии выбрасывается целиком, а не подставляется нулём. День без HF
 * перестаёт быть соседним по календарю, и splitRuns рвёт линию сам —
 * ровно как на пропущенном снепшоте. HF = 0 означал бы «ликвидация уже
 * произошла», LTV = 0 — «долга нет»; и то и другое — неправда о дне,
 * в который данных просто не было.
 *
 * ДВУЗНАЧНЫЙ NULL У HF разбирается здесь и только здесь: в снепшоте
 * `healthFactor === null` означает либо «долга нет» («∞»), либо «здоровье
 * не читалось», и различает их `debtUsd` (0 против null). В серию HF
 * не попадает ни тот, ни другой случай — бесконечность на оси не рисуется, —
 * но в LTV день без долга попадает честным нулём: залог известен, долга нет,
 * отношение равно нулю.
 */

export interface RiskPoint {
  /** Календарный день UTC, YYYY-MM-DD. */
  takenOn: string;
  /** HF или LTV в процентах — в зависимости от серии. Никогда не null. */
  value: number;
  /** Снепшот помечен частичным — точку нужно пометить и на графике. */
  isPartial: boolean;
}

/** Метрика карточки: две проекции одного и того же плеча. */
export type RiskMetric = "hf" | "ltv";

/**
 * Серия health factor. Дни, в которые долга не было («∞»), и дни, в которые
 * здоровье не читалось, в серию не попадают — оба случая на оси HF
 * не изображаются.
 */
export function hfSeries(snapshots: readonly SnapshotDto[]): RiskPoint[] {
  const points: RiskPoint[] = [];
  for (const snapshot of snapshots) {
    const hf = snapshot.healthFactor;
    if (hf === null || !Number.isFinite(hf)) continue;
    points.push({
      takenOn: snapshot.takenOn,
      value: hf,
      isPartial: snapshot.isPartial,
    });
  }
  return points;
}

/**
 * Серия LTV в процентах: долг / залог. Оба числа берутся из одного базиса
 * (оракул Aave), иначе отношение не сошлось бы ни с приложением, ни с самим
 * Aave. Залог = 0 (или неизвестен) точку не даёт: отношения нет.
 */
export function ltvSeries(snapshots: readonly SnapshotDto[]): RiskPoint[] {
  const points: RiskPoint[] = [];
  for (const snapshot of snapshots) {
    const { debtUsd, collateralUsd } = snapshot;
    if (debtUsd === null || collateralUsd === null) continue;
    if (!(collateralUsd > 0)) continue;
    points.push({
      takenOn: snapshot.takenOn,
      value: (debtUsd / collateralUsd) * 100,
      isPartial: snapshot.isPartial,
    });
  }
  return points;
}

export function riskSeries(
  snapshots: readonly SnapshotDto[],
  metric: RiskMetric,
): RiskPoint[] {
  return metric === "hf" ? hfSeries(snapshots) : ltvSeries(snapshots);
}

export interface RiskChange {
  from: number;
  to: number;
  abs: number;
}

/**
 * Изменение за период — только в единицах метрики, без процентов.
 * «HF вырос на 12%» читается как процент чего-то, а HF сам по себе
 * не проценты; у LTV процент от процента — и вовсе ловушка.
 */
export function riskChange(points: readonly RiskPoint[]): RiskChange | null {
  if (points.length < 2) return null;
  const from = points[0].value;
  const to = points[points.length - 1].value;
  return { from, to, abs: to - from };
}

/**
 * Худшее значение периода: у HF это минимум (ближе всего к ликвидации),
 * у LTV — максимум. Одно число вместо пары «максимум / минимум»: у метрики
 * риска интересна та сторона, с которой приходит ликвидация.
 */
export function worstValue(
  points: readonly RiskPoint[],
  metric: RiskMetric,
): number | null {
  if (points.length === 0) return null;
  const values = points.map((p) => p.value);
  return metric === "hf" ? Math.min(...values) : Math.max(...values);
}
