"use client";

import { DcCard } from "@/components/dc/card";
import { HelpTip } from "@/components/dc/help-tip";
import { ASSET_COLOR } from "@/components/dc/protocols";
import { TooltipCard } from "@/components/dc/tooltip-card";
import { CATEGORY_UNIT } from "@/components/trades/categories";
import type { PortfolioCategory, SnapshotDto } from "@/lib/api/types";
import {
  NBSP,
  dcUsd,
  dcUsdSigned,
  tableDate,
  tableNumber,
  tablePctSigned,
  tableSigned,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChartNote } from "./chart-parts";
import { countMissingDays } from "./chart-geometry";
import { HISTORY_CARD_LABEL } from "./labels";
import {
  QUANTITY_DECIMALS,
  type QuantityPoint,
  periodChange,
  quantitySeries,
} from "./quantity-series";
import {
  SeriesChart,
  compactValue,
  seriesAxis,
  seriesRows,
} from "./recharts-parts";

/**
 * Главный блок «Истории»: количества BTC и ETH, затем стейблы.
 *
 * BTC/ETH — базовые активы Capital Growth, поэтому получают полноценные
 * графики с осями и одинаковый визуальный вес. Стейблы важны как рабочий
 * капитал, но не являются целью накопления — остаются компактным summary.
 *
 * По оси Y — счётчик монет из сохранённого состава точки, а не эквивалент
 * по цене: кривая накопления обязана стоять, пока владелец ничего не делал
 * (quantity-series.ts, lib/portfolio/coin-count.ts).
 */

const PRIMARY_CATEGORIES = ["btc", "eth"] as const;
const STABLE_SPARK_HEIGHT = 64;

export function QuantityCharts({
  snapshots,
  periodLabel,
}: {
  snapshots: SnapshotDto[];
  periodLabel: string;
}) {
  return (
    <section aria-labelledby="base-assets-history" className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 id="base-assets-history" className="t-h2">
          Накопление базовых активов
        </h2>
        <HelpTip>
          Количество BTC и ETH — главная метрика стратегии. Считается по
          монетам в составе снепшота и от движения цен не зависит: обёртки
          и LST идут по номиналу (1 wstETH = 1 ETH). Долларовая стоимость
          показана ниже только как рыночный контекст.
        </HelpTip>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {PRIMARY_CATEGORIES.map((category) => (
          <PrimaryQuantityCard
            key={category}
            category={category}
            points={quantitySeries(snapshots, category)}
            periodLabel={periodLabel}
          />
        ))}
      </div>

      <StableQuantitySummary
        points={quantitySeries(snapshots, "stable")}
        periodLabel={periodLabel}
      />
    </section>
  );
}

function PrimaryQuantityCard({
  category,
  points,
  periodLabel,
}: {
  category: (typeof PRIMARY_CATEGORIES)[number];
  points: QuantityPoint[];
  periodLabel: string;
}) {
  const decimals = QUANTITY_DECIMALS[category];
  const unit = CATEGORY_UNIT[category];
  const color = ASSET_COLOR[category];
  const last = points.at(-1) ?? null;
  const change = periodChange(points);
  const missing = countMissingDays(points);
  const anyPartial = points.some((point) => point.isPartial);

  return (
    <DcCard as="article" className="flex min-w-0 flex-col">
      <div className="px-card pt-4 pb-3.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-[7px] shrink-0 rounded-full"
            style={{ background: color }}
          />
          <h3 className="t-h3">{HISTORY_CARD_LABEL[category]}</h3>
        </div>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
          <p className="flex min-w-0 items-baseline gap-2">
            <span className="t-metric-lg">
              {last === null ? (
                <span className="text-text-3">—</span>
              ) : (
                tableNumber(last.quantity, decimals)
              )}
            </span>
            <span className="text-[13px] text-text-3">{unit}</span>
          </p>
          <span className="t-meta">
            <ChangeText
              change={change}
              decimals={decimals}
              empty={last === null}
              periodLabel={periodLabel}
            />
          </span>
        </div>
      </div>

      <QuantityPlot
        points={points}
        category={category}
        color={color}
        decimals={decimals}
        unit={unit}
        periodLabel={periodLabel}
      />

      <ChartNote
        missing={missing}
        anyPartial={anyPartial}
        missingLabel="дни без количества"
        className="border-line border-t px-card py-3"
      />
    </DcCard>
  );
}

function StableQuantitySummary({
  points,
  periodLabel,
}: {
  points: QuantityPoint[];
  periodLabel: string;
}) {
  const category = "stable" as const;
  const color = ASSET_COLOR[category];
  const last = points.at(-1) ?? null;
  const change = periodChange(points);

  return (
    <DcCard
      as="article"
      className="grid min-w-0 md:grid-cols-[minmax(0,1fr)_240px]"
    >
      <div className="flex min-w-0 flex-col justify-center gap-2.5 px-card py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-[7px] shrink-0 rounded-full"
            style={{ background: color }}
          />
          <h3 className="t-h3">Стейблы</h3>
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="t-metric-sm">
            {last === null ? "—" : dcUsd(last.quantity)}
          </span>
          <span className="t-meta">
            <StableChangeText
              change={change}
              empty={last === null}
              periodLabel={periodLabel}
            />
          </span>
        </div>
      </div>

      <div className="border-line border-t bg-sunken md:border-t-0 md:border-l">
        <CompactSparkline
          points={points}
          category={category}
          color={color}
          decimals={QUANTITY_DECIMALS[category]}
          unit={CATEGORY_UNIT[category]}
          periodLabel={periodLabel}
        />
      </div>
    </DcCard>
  );
}

/** Ноль — факт «без изменений»; одна точка честно не изображает динамику. */
function ChangeText({
  change,
  decimals,
  empty,
  periodLabel,
}: {
  change: ReturnType<typeof periodChange>;
  decimals: number;
  empty: boolean;
  periodLabel: string;
}) {
  if (empty) return <span className="text-text-3">нет данных</span>;
  if (change === null)
    return <span className="text-text-3">нужна вторая точка</span>;
  if (change.abs === 0)
    return <span className="text-text-3">без изменений за {periodLabel}</span>;
  return (
    <>
      <span className={change.abs > 0 ? "text-profit" : "text-loss"}>
        {tableSigned(change.abs, decimals)}
        {change.pct !== null && (
          <>
            {NBSP}·{NBSP}
            {tablePctSigned(change.pct, 1)}
          </>
        )}
      </span>{" "}
      <span className="text-text-3">за {periodLabel}</span>
    </>
  );
}

function StableChangeText({
  change,
  empty,
  periodLabel,
}: {
  change: ReturnType<typeof periodChange>;
  empty: boolean;
  periodLabel: string;
}) {
  if (empty) return <span className="text-text-3">нет данных</span>;
  if (change === null)
    return <span className="text-text-3">нужна вторая точка</span>;
  if (change.abs === 0)
    return <span className="text-text-3">без изменений за {periodLabel}</span>;
  return (
    <>
      <span className={change.abs > 0 ? "text-profit" : "text-loss"}>
        {dcUsdSigned(change.abs)}
        {change.pct !== null && (
          <>
            {NBSP}·{NBSP}
            {tablePctSigned(change.pct, 1)}
          </>
        )}
      </span>{" "}
      <span className="text-text-3">за {periodLabel}</span>
    </>
  );
}

function QuantityPlot({
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
  return (
    <div className="border-line border-t bg-sunken px-3 pt-2 pb-2">
      <div className="relative h-[178px] sm:h-[198px]">
        {points.length < 2 ? (
          <p className="t-meta absolute inset-0 grid place-items-center px-4 text-center text-text-3">
            {points.length === 0
              ? "Нет данных количества за выбранный период."
              : "Одна точка — кривой нужна вторая."}
          </p>
        ) : (
          <QuantitySeries
            points={points}
            category={category}
            color={color}
            decimals={decimals}
            unit={unit}
            periodLabel={periodLabel}
          />
        )}
      </div>
    </div>
  );
}

function QuantitySeries({
  points,
  category,
  color,
  decimals,
  unit,
  periodLabel,
  compact = false,
}: {
  points: QuantityPoint[];
  category: PortfolioCategory;
  color: string;
  decimals: number;
  unit: string;
  periodLabel: string;
  compact?: boolean;
}) {
  const axis = seriesAxis(points.map((point) => point.quantity));
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
    <SeriesChart
      rows={rows}
      axis={axis}
      color={color}
      fillOpacity={compact ? 0.16 : 0.18}
      compact={compact}
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
  );
}

function CompactSparkline({
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
  return (
    <div
      className={cn("px-3", points.length < 2 && "grid place-items-center")}
      style={{ height: STABLE_SPARK_HEIGHT }}
    >
      {points.length < 2 ? (
        <span className="t-meta text-text-3" aria-hidden>
          {points.length === 0 ? "нет данных" : "нужна вторая точка"}
        </span>
      ) : (
        <QuantitySeries
          points={points}
          category={category}
          color={color}
          decimals={decimals}
          unit={unit}
          periodLabel={periodLabel}
          compact
        />
      )}
    </div>
  );
}
