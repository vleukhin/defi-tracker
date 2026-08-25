"use client";

import { DcCard } from "@/components/dc/card";
import { TooltipCard } from "@/components/dc/tooltip-card";
import { ASSET_COLOR } from "@/components/dc/protocols";
import {
  CATEGORY_UNIT,
  TRADE_CATEGORIES,
} from "@/components/trades/categories";
import type { PortfolioCategory, SnapshotDto } from "@/lib/api/types";
import {
  NBSP,
  tableDate,
  tableNumber,
  tablePctSigned,
  tableSigned,
} from "@/lib/format";
import { countMissingDays } from "./chart-geometry";
import {
  SeriesChart,
  compactValue,
  seriesAxis,
  seriesRows,
} from "./recharts-parts";
import { HISTORY_CARD_LABEL } from "./labels";
import {
  QUANTITY_DECIMALS,
  type QuantityPoint,
  periodChange,
  quantitySeries,
} from "./quantity-series";

/**
 * Три компактные карточки количеств (README, экран 5): точка цвета актива
 * + название, значение Mono 22px + дельта, спарклайн по нижнему краю.
 *
 * Это ГЛАВНАЯ метрика стратегии (AGENTS.md): портфель считается в монетах,
 * а не в долларах. Растущая долларовая кривая может быть целиком заслугой
 * цены — здесь видно, прибавилось ли монет на самом деле.
 *
 * Три отдельных графика с собственными доменами: 1,26 BTC, 16,9 ETH
 * и $39 548 на общей шкале превратили бы BTC и ETH в прямую по нулю.
 */

/** Высота спарклайна из эталона (designs, страница «История»). */
const SPARK_HEIGHT = 88;

export function QuantityCharts({
  snapshots,
  periodLabel,
}: {
  snapshots: SnapshotDto[];
  periodLabel: string;
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {TRADE_CATEGORIES.map((category) => (
        <QuantityCard
          key={category.key}
          category={category.key}
          points={quantitySeries(snapshots, category.key)}
          periodLabel={periodLabel}
        />
      ))}
    </section>
  );
}

function QuantityCard({
  category,
  points,
  periodLabel,
}: {
  category: PortfolioCategory;
  points: QuantityPoint[];
  periodLabel: string;
}) {
  const decimals = QUANTITY_DECIMALS[category];
  const unit = CATEGORY_UNIT[category];
  const color = ASSET_COLOR[category];
  const last = points.at(-1) ?? null;
  const change = periodChange(points);

  return (
    <DcCard className="flex flex-col justify-between">
      <div className="flex flex-col gap-2.5 px-card pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-[7px] shrink-0 rounded-full"
            style={{ background: color }}
          />
          <span className="text-[13px] font-medium">
            {HISTORY_CARD_LABEL[category]}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="font-mono text-[22px] leading-none font-medium tracking-[-0.03em]">
            {last === null ? (
              <span className="text-text-3">—</span>
            ) : (
              tableNumber(last.quantity, decimals)
            )}
          </span>
          <span className="t-meta">
            <ChangeText
              change={change}
              decimals={decimals}
              empty={last === null}
            />
          </span>
        </div>
      </div>

      <Sparkline
        points={points}
        category={category}
        color={color}
        decimals={decimals}
        unit={unit}
        periodLabel={periodLabel}
      />
    </DcCard>
  );
}

/**
 * Дельта количества за период. Ноль — не «+0,0000», а «без изменений»:
 * у накопителя это осмысленный факт, а не пустое значение.
 */
function ChangeText({
  change,
  decimals,
  empty,
}: {
  change: ReturnType<typeof periodChange>;
  decimals: number;
  empty: boolean;
}) {
  if (empty) return <span className="text-text-3">нет данных</span>;
  if (change === null) return <span className="text-text-3">одна точка</span>;
  if (change.abs === 0)
    return <span className="text-text-3">без изменений</span>;
  return (
    <span className={change.abs > 0 ? "text-profit" : "text-loss"}>
      {tableSigned(change.abs, decimals)}
      {change.pct !== null && (
        <>
          {NBSP}·{NBSP}
          {tablePctSigned(change.pct, 1)}
        </>
      )}
    </span>
  );
}

/**
 * Спарклайн по нижнему краю карточки: цвет актива, заливка 22% → 0.
 * Сетки и осей здесь нет намеренно — на 88 пикселях им не место, а число
 * и дельта уже стоят в шапке карточки. Значение точки показывает тултип.
 */
function Sparkline({
  points,
  category,
  color,
  decimals,
  unit,
  periodLabel,
}: {
  points: QuantityPoint[];
  category: PortfolioCategory;
  color: string;
  decimals: number;
  unit: string;
  periodLabel: string;
}) {
  if (points.length < 2) {
    // Ни одной или одна точка: пустая ось выглядела бы как «количество = 0»
    return <div style={{ height: SPARK_HEIGHT }} aria-hidden />;
  }

  const axis = seriesAxis(points.map((p) => p.quantity));
  const rows = seriesRows(
    points,
    (point) => point.quantity,
    (point) => point.isPartial,
  );
  const missing = countMissingDays(points);
  const first = points[0];
  const last = points[points.length - 1];
  const change = periodChange(points)!;

  const ariaLabel =
    `Динамика количества ${HISTORY_CARD_LABEL[category]}, ${periodLabel}: ` +
    `с ${tableDate(first.takenOn)} по ${tableDate(last.takenOn)}, ` +
    `с ${tableNumber(change.from, decimals)} до ` +
    `${tableNumber(change.to, decimals)} ${unit}, ` +
    `изменение ${tableSigned(change.abs, decimals)} ${unit}` +
    (change.pct === null ? "" : ` (${tablePctSigned(change.pct, 1)})`) +
    (missing > 0 ? `. Дней без количества: ${missing}` : "");

  return (
    <div style={{ height: SPARK_HEIGHT }}>
      <SeriesChart
        rows={rows}
        axis={axis}
        color={color}
        fillOpacity={0.22}
        compact
        ariaLabel={ariaLabel}
        formatY={compactValue}
        renderTooltip={(row) => (
          <TooltipCard
            title={tableDate(row.takenOn)}
            note={row.isPartial ? "частичные данные" : undefined}
          >
            {tableNumber(row.value!, decimals)}
            <span className="ml-1 text-[11.5px] font-normal text-text-3">
              {unit}
            </span>
          </TooltipCard>
        )}
      />
    </div>
  );
}
