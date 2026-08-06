import { z } from "zod";
import type { SnapshotComposition } from "@/lib/portfolio/snapshot";
import type { SnapshotDto, SnapshotPeriod } from "./types";
import {
  PORTFOLIO_CATEGORIES,
  type PortfolioCategory,
} from "@/lib/portfolio/portfolio";

/**
 * Общая часть роутов истории снепшотов (Фаза 3, S3.2):
 * набор колонок, разбор периода и маппинг строк БД в DTO.
 */

export const snapshotPeriodSchema = z.enum([
  "7d",
  "30d",
  "90d",
  "1y",
  "all",
]);

/** Период по умолчанию — месяц: достаточно точек, чтобы график был читаемым. */
export const DEFAULT_PERIOD: SnapshotPeriod = "30d";

const PERIOD_DAYS: Record<Exclude<SnapshotPeriod, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

/**
 * Нижняя граница периода как календарный день UTC (YYYY-MM-DD) или null
 * для «все время». Сравнение идет по taken_on (date), а не по taken_at:
 * период меряется в днях, и точное время съема на попадание не влияет.
 */
export function periodCutoff(
  period: SnapshotPeriod,
  nowMs: number = Date.now(),
): string | null {
  if (period === "all") return null;
  const days = PERIOD_DAYS[period];
  // Включительно: «7 дней» = сегодня и шесть предыдущих дней
  const from = new Date(nowMs - (days - 1) * 86_400_000);
  return from.toISOString().slice(0, 10);
}

/** Колонки снепшота вместе с составом (embedded resource PostgREST). */
export const SNAPSHOT_COLUMNS =
  "id, taken_on, taken_at, total_usd, debt_usd, collateral_usd, health_factor, " +
  "positions_usd, free_usd, free_borrowed_usd, is_partial, " +
  "snapshot_items (category, quantity, composition, price_usd, value_usd, percent, collateral_usd, manual_usd, free_usd)";

export interface SnapshotItemRow {
  category: string;
  quantity: number | string | null;
  /** Может отсутствовать у снепшотов, снятых до появления поля. */
  composition?: SnapshotComposition | null;
  price_usd: number | string | null;
  value_usd: number | string;
  percent: number | string;
  collateral_usd: number | string;
  manual_usd: number | string;
  /** Отсутствует у снепшотов, снятых до чтения свободных балансов. */
  free_usd?: number | string | null;
}

export interface SnapshotRow {
  id: string;
  taken_on: string;
  taken_at: string;
  total_usd: number | string;
  /** Долг на момент съема (Фаза 4); null у старых снепшотов = «неизвестен». */
  debt_usd?: number | string | null;
  /** Залог оракула Aave; отсутствует у снепшотов до появления колонки. */
  collateral_usd?: number | string | null;
  /** Минимальный HF; null = долга нет или не читалось (различает debt_usd). */
  health_factor?: number | string | null;
  positions_usd?: number | string | null;
  /** null у снепшотов, снятых до чтения свободных балансов. */
  free_usd?: number | string | null;
  /** Отсутствует у снепшотов, снятых до появления колонки. */
  free_borrowed_usd?: number | string | null;
  is_partial: boolean;
  snapshot_items: SnapshotItemRow[] | null;
}

/** numeric приезжает из PostgREST строкой — приводим на границе API. */
function num(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function nullableNum(value: number | string | null): number | null {
  return value === null ? null : num(value);
}

const CATEGORY_ORDER = new Map<string, number>(
  PORTFOLIO_CATEGORIES.map((c, i) => [c, i]),
);

export function mapSnapshotRow(row: SnapshotRow): SnapshotDto {
  const items = (row.snapshot_items ?? [])
    // Порядок состава фиксирован (btc / eth / stable), а не «как отдала БД»
    .slice()
    .sort(
      (a, b) =>
        (CATEGORY_ORDER.get(a.category) ?? 99) -
        (CATEGORY_ORDER.get(b.category) ?? 99),
    )
    .map((item) => ({
      category: item.category as PortfolioCategory,
      quantity: nullableNum(item.quantity),
      // Сырые количества монет: не зависят от цен, поэтому отдаются как есть
      composition: item.composition ?? { collateral: [], manual: [] },
      priceUsd: nullableNum(item.price_usd),
      valueUsd: num(item.value_usd),
      percent: num(item.percent),
      collateralUsd: num(item.collateral_usd),
      manualUsd: num(item.manual_usd),
      // Старые точки колонки не знали: там ноль — «свободных не учитывали»,
      // и это ровно то, что было
      freeUsd: num(item.free_usd ?? 0),
    }));

  return {
    id: row.id,
    takenOn: row.taken_on,
    takenAt: row.taken_at,
    totalUsd: num(row.total_usd),
    debtUsd: nullableNum(row.debt_usd ?? null),
    collateralUsd: nullableNum(row.collateral_usd ?? null),
    healthFactor: nullableNum(row.health_factor ?? null),
    positionsUsd: nullableNum(row.positions_usd ?? null),
    freeUsd: nullableNum(row.free_usd ?? null),
    // Именно `?? null`, в отличие от item-level free_usd ниже: ноль здесь
    // означал бы «заемных на кошельке не было», а точка о них просто не знала
    freeBorrowedUsd: nullableNum(row.free_borrowed_usd ?? null),
    isPartial: row.is_partial,
    items,
  };
}
