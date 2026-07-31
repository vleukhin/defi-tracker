"use client";

import { useState } from "react";
import { pnlClass } from "@/components/pnl";
import {
  CATEGORY_BG,
  CATEGORY_VAR,
  CategoryDot,
} from "@/components/portfolio/category";
import {
  CATEGORY_LABEL,
  CATEGORY_UNIT,
  TRADE_CATEGORIES,
} from "@/components/trades/categories";
import { Card } from "@/components/ui/card";
import type { PortfolioCategory, SnapshotDto } from "@/lib/api/types";
import {
  NBSP,
  tableDate,
  tableNumber,
  tablePctSigned,
  tableSigned,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  areaPath,
  bandCenter,
  countMissingDays,
  hitRegions,
  linePath,
  niceTicks,
  splitRuns,
  timeScale,
  yPercent,
} from "./chart-geometry";
import {
  ChartLegend,
  ChartTimeAxis,
  ChartTooltip,
  HoverLayer,
} from "./chart-parts";
import {
  QUANTITY_DECIMALS,
  type QuantityPoint,
  periodChange,
  quantitySeries,
  tickDecimals,
} from "./quantity-series";

/**
 * Графики количества монет по категориям (S3.1: «для стратегии накопления
 * динамика количества монет важнее кривой стоимости»). Растущая долларовая
 * кривая может быть целиком заслугой цены — здесь видно, прибавилось ли
 * монет на самом деле.
 *
 * Три ОТДЕЛЬНЫХ графика с собственными осями Y: 1,26 BTC, 16,9 ETH
 * и $39 548 на общей шкале превратили бы BTC и ETH в прямую по нулю.
 *
 * Разметка и поведение — как у графика стоимости (value-chart.tsx):
 * инлайновый SVG viewBox 0…100 + preserveAspectRatio="none", маркеры
 * в HTML-слое, разрывы на днях без данных, тултипы с клавиатуры.
 */

/** Сплошные точки при небольшом числе снепшотов; дальше — только линия. */
const DOTS_LIMIT = 45;

export function QuantityCharts({
  snapshots,
  periodLabel,
}: {
  snapshots: SnapshotDto[];
  periodLabel: string;
}) {
  return (
    <div className="space-y-4">
      {TRADE_CATEGORIES.map((category) => (
        <QuantityChart
          key={category.key}
          category={category.key}
          points={quantitySeries(snapshots, category.key)}
          periodLabel={periodLabel}
        />
      ))}
    </div>
  );
}

function QuantityChart({
  category,
  points,
  periodLabel,
}: {
  category: PortfolioCategory;
  points: QuantityPoint[];
  periodLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const unit = CATEGORY_UNIT[category];
  const decimals = QUANTITY_DECIMALS[category];

  // Ни одного дня с количеством: цены категории не было ни разу. Пустая
  // ось без единой точки выглядела бы как «количество = 0» — говорим прямо
  if (points.length === 0) {
    return (
      <QuantityCard category={category}>
        <p className="mt-3 text-sm text-muted-foreground">
          Нет данных о количестве: цены категории на моменты съема не было,
          эквивалент не выведен.
        </p>
      </QuantityCard>
    );
  }

  const last = points[points.length - 1];

  // Одна точка — не динамика: линия по ней была бы вымыслом (как и на
  // графике стоимости), показываем сам факт количества на дату
  if (points.length === 1) {
    return (
      <QuantityCard category={category}>
        <div className="mt-3 flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "size-3 shrink-0 rounded-full",
              last.isPartial
                ? "border-2 border-warning bg-background"
                : CATEGORY_BG[category],
            )}
          />
          <div>
            <p className="font-mono text-xl leading-none font-semibold tracking-tight">
              {tableNumber(last.quantity, decimals)}
              {NBSP}
              {unit}
            </p>
            <p className="mt-1.5 font-mono text-xs text-muted-foreground">
              {tableDate(last.takenOn)}
            </p>
          </div>
        </div>
      </QuantityCard>
    );
  }

  const scale = timeScale(points)!;
  const values = points.map((p) => p.quantity);
  // Домен НЕ прибивается к нулю: для накопления значима форма изменения,
  // а +0,01 BTC на фоне нуля был бы неотличим от прямой
  const axis = niceTicks(Math.min(...values), Math.max(...values));
  const axisDecimals = tickDecimals(axis, decimals);

  const plot = points.map((point) => ({
    takenOn: point.takenOn,
    x: bandCenter(scale, point.takenOn),
    y: yPercent(axis, point.quantity),
    point,
  }));
  const runs = splitRuns(plot);
  const zones = hitRegions(plot.map((p) => p.x));
  // Дни без количества выпали из серии еще в quantitySeries — здесь они
  // считаются вместе с днями без снепшота: и то, и другое суть разрыв
  const missing = countMissingDays(points);
  const anyPartial = points.some((p) => p.isPartial);

  const change = periodChange(points)!;
  const first = points[0];

  const ariaLabel =
    `Динамика количества ${CATEGORY_LABEL[category]}, ${periodLabel}: ` +
    `с ${tableDate(first.takenOn)} по ${tableDate(last.takenOn)}, ` +
    `с ${tableNumber(change.from, decimals)} до ` +
    `${tableNumber(change.to, decimals)} ${unit}, ` +
    `изменение ${tableSigned(change.abs, decimals)} ${unit}` +
    (change.pct === null ? "" : ` (${tablePctSigned(change.pct, 1)})`) +
    (missing > 0 ? `. Дней без количества: ${missing}` : "") +
    (anyPartial ? ". Часть точек помечена как частичные данные" : "");

  return (
    <QuantityCard
      category={category}
      summary={
        <>
          <span className="font-mono">
            {tableNumber(last.quantity, decimals)}
          </span>
          {NBSP}
          {unit}
          {" · "}
          <span className={cn("font-mono", pnlClass(change.abs))}>
            {tableSigned(change.abs, decimals)}
            {change.pct !== null && ` (${tablePctSigned(change.pct, 1)})`}
          </span>{" "}
          за период
        </>
      }
    >
      {/* Тот же левый отступ, что у графика стоимости: все оси времени
          на экране стоят на одной вертикали */}
      <div className="relative mt-3 pl-14 sm:pl-16">
        <div className="relative h-36 sm:h-44">
          {/* Сетка и подписи оси Y */}
          {axis.ticks.map((tick) => {
            const top = yPercent(axis, tick);
            return (
              <div
                key={tick}
                aria-hidden="true"
                className="absolute inset-x-0"
                style={{ top: `${top}%` }}
              >
                <div className="border-t border-border/70" />
                <span className="absolute right-full -top-2 pr-2 font-mono text-[10px] whitespace-nowrap text-muted-foreground">
                  {tableNumber(tick, axisDecimals)}
                </span>
              </div>
            );
          })}

          <svg
            role="img"
            aria-label={ariaLabel}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
          >
            {runs.map((run) => (
              <path
                key={`area-${run[0].takenOn}`}
                d={areaPath(run)}
                fill={CATEGORY_VAR[category]}
                opacity={0.14}
              />
            ))}
            {runs.map((run) => (
              <path
                key={`line-${run[0].takenOn}`}
                d={linePath(run)}
                fill="none"
                stroke={CATEGORY_VAR[category]}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {/* Маркеры — HTML-слой: в растянутом viewBox круги стали бы овалами */}
          {plot.map((item, i) => {
            const partial = item.point.isPartial;
            const isolated = runs.some(
              (run) => run.length === 1 && run[0] === item,
            );
            const show =
              partial || isolated || active === i || points.length <= DOTS_LIMIT;
            if (!show) return null;
            return (
              <span
                key={item.takenOn}
                aria-hidden="true"
                style={{
                  left: `${item.x}%`,
                  top: `${item.y}%`,
                  boxShadow:
                    active === i && !partial
                      ? `0 0 0 3px color-mix(in oklab, ${CATEGORY_VAR[category]} 30%, transparent)`
                      : undefined,
                }}
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2 rounded-full",
                  partial
                    ? // Частичная точка отличается ФОРМОЙ (полая), а не только цветом
                      "size-2.5 border-2 border-warning bg-background"
                    : cn("size-1.5", CATEGORY_BG[category]),
                  active === i && !partial && "size-2.5",
                )}
              />
            );
          })}

          <HoverLayer
            zones={zones.map((zone, i) => ({
              ...zone,
              label: pointLabel(points[i], category),
            }))}
            onActive={setActive}
          />

          {active !== null && (
            <ChartTooltip x={plot[active].x}>
              <span className="font-mono">
                {tableDate(points[active].takenOn)}
              </span>
              {" · "}
              <span className="font-mono font-medium">
                {tableNumber(points[active].quantity, decimals)}
                {NBSP}
                {unit}
              </span>
              {points[active].isPartial && (
                <span className="block text-warning">частичные данные</span>
              )}
            </ChartTooltip>
          )}
        </div>

        {/* Подписи оси X: на узких экранах их меньше — даты не наезжают */}
        <ChartTimeAxis points={plot} />
      </div>

      <ChartLegend
        missing={missing}
        anyPartial={anyPartial}
        missingLabel="дни без количества"
      />
    </QuantityCard>
  );
}

/** Общая карточка графика количества: заголовок с точкой категории. */
function QuantityCard({
  category,
  summary,
  children,
}: {
  category: PortfolioCategory;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <CategoryDot category={category} />
          Количество {CATEGORY_LABEL[category]}
        </h2>
        {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
      </div>
      {children}
    </Card>
  );
}

function pointLabel(point: QuantityPoint, category: PortfolioCategory): string {
  return (
    `${tableDate(point.takenOn)}: ` +
    `${tableNumber(point.quantity, QUANTITY_DECIMALS[category])}${NBSP}` +
    `${CATEGORY_UNIT[category]}` +
    (point.isPartial ? ", частичные данные" : "")
  );
}
