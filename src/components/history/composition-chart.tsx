"use client";

import { useState } from "react";
import { CATEGORY_VAR, CategoryDot } from "@/components/portfolio/category";
import { CATEGORY_LABEL, TRADE_CATEGORIES } from "@/components/trades/categories";
import { Card } from "@/components/ui/card";
import type { PortfolioCategory, SnapshotDto } from "@/lib/api/types";
import { tableDate, tablePct, tableUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  bandCenter,
  bandLeft,
  countMissingDays,
  hitRegions,
  pickTickIndices,
  timeScale,
} from "./chart-geometry";
import { ChartTooltip, HoverLayer } from "./chart-hover";
import { ChartLegend } from "./value-chart";

/**
 * График пропорций трех категорий во времени (S3.2): стековые полосы
 * на 100% — по одной на снепшот, поставленные на КАЛЕНДАРНУЮ ось.
 *
 * Почему полосы, а не сглаженная area: при плотной истории полосы
 * сливаются в ту же непрерывную ленту, а пропущенные дни остаются
 * буквально пустыми колонками — разрыв виден сам собой и не требует
 * интерполяции (S3.2).
 */

/** Плотнее — полосы смыкаются в ленту; реже — с зазором, как столбцы. */
const DENSE_SPAN = 45;

interface Slice {
  category: PortfolioCategory;
  /** Доля в процентах, нормированная так, что сумма = 100. */
  pct: number;
  valueUsd: number;
}

/**
 * Доли снепшота, нормированные к 100%: проценты в составе округлены
 * и в сумме дают 99,99 — полоса не должна упираться в белую щель сверху.
 */
function slices(snapshot: SnapshotDto): Slice[] {
  const raw = TRADE_CATEGORIES.map((c) => {
    const item = snapshot.items.find((i) => i.category === c.key);
    return {
      category: c.key,
      pct: item?.percent ?? 0,
      valueUsd: item?.valueUsd ?? 0,
    };
  });
  const sum = raw.reduce((acc, s) => acc + s.pct, 0);
  if (sum <= 0) return raw;
  return raw.map((s) => ({ ...s, pct: (s.pct / sum) * 100 }));
}

export function CompositionChart({
  snapshots,
  periodLabel,
}: {
  snapshots: SnapshotDto[];
  periodLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const scale = timeScale(snapshots)!;
  const dense = scale.span > DENSE_SPAN;
  // Зазор между столбцами только пока они различимы глазом
  const barWidth = dense ? scale.slot : scale.slot * 0.82;
  const barOffset = (scale.slot - barWidth) / 2;

  const bars = snapshots.map((snapshot) => ({
    snapshot,
    left: bandLeft(scale, snapshot.takenOn) + barOffset,
    center: bandCenter(scale, snapshot.takenOn),
    slices: slices(snapshot),
    empty: snapshot.totalUsd === 0,
  }));

  const missing = countMissingDays(snapshots);
  const anyPartial = snapshots.some((s) => s.isPartial);
  const zones = hitRegions(bars.map((b) => b.center));
  const lastSlices = bars[bars.length - 1].slices;

  const ariaLabel =
    `Пропорции категорий, ${periodLabel}. ` +
    `На ${tableDate(snapshots[snapshots.length - 1].takenOn)}: ` +
    lastSlices
      .map((s) => `${CATEGORY_LABEL[s.category]} ${tablePct(s.pct)}`)
      .join(", ") +
    (missing > 0 ? `. Дней без снепшота: ${missing}` : "");

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">Пропорции категорий</h2>

      <div className="relative mt-3">
        <div className="relative h-32 sm:h-40 overflow-hidden rounded-md">
          <svg
            role="img"
            aria-label={ariaLabel}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
          >
            {bars.map((bar) => {
              if (bar.empty) {
                return (
                  <rect
                    key={bar.snapshot.takenOn}
                    x={bar.left}
                    y={0}
                    width={barWidth}
                    height={100}
                    fill="var(--muted)"
                  />
                );
              }
              let y = 0;
              return (
                <g key={bar.snapshot.takenOn}>
                  {bar.slices.map((slice) => {
                    const top = y;
                    y += slice.pct;
                    if (slice.pct <= 0) return null;
                    return (
                      <rect
                        key={slice.category}
                        x={bar.left}
                        y={top}
                        width={barWidth}
                        height={slice.pct}
                        fill={CATEGORY_VAR[slice.category]}
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>

          {/* Частичные точки: полая метка над столбцом — отличие формой */}
          {bars.map((bar) =>
            bar.snapshot.isPartial ? (
              <span
                key={`partial-${bar.snapshot.takenOn}`}
                aria-hidden="true"
                style={{ left: `${bar.center}%` }}
                className="absolute top-1 size-2.5 -translate-x-1/2 rounded-full border-2 border-warning bg-background"
              />
            ) : null,
          )}

          <HoverLayer
            zones={zones.map((zone, i) => ({
              ...zone,
              label: pointLabel(bars[i].snapshot, bars[i].slices),
            }))}
            onActive={setActive}
          />
        </div>

        {active !== null && (
          <ChartTooltip x={bars[active].center}>
            <span className="font-mono">
              {tableDate(snapshots[active].takenOn)}
            </span>
            <span className="mt-1 grid gap-0.5">
              {bars[active].slices.map((slice) => (
                <span key={slice.category} className="flex items-center gap-1.5">
                  <CategoryDot category={slice.category} />
                  <span>{CATEGORY_LABEL[slice.category]}</span>
                  <span className="ml-auto pl-2 font-mono">
                    {tablePct(slice.pct)}
                  </span>
                </span>
              ))}
            </span>
            {snapshots[active].isPartial && (
              <span className="mt-1 block text-warning">частичные данные</span>
            )}
          </ChartTooltip>
        )}

        <XAxis bars={bars} count={3} className="sm:hidden" />
        <XAxis bars={bars} count={5} className="hidden sm:block" />
      </div>

      {/* Легенда категорий: доля на последнюю дату периода */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {lastSlices.map((slice) => (
          <span key={slice.category} className="inline-flex items-center gap-1.5">
            <CategoryDot category={slice.category} />
            <span className="text-xs">{CATEGORY_LABEL[slice.category]}</span>
            <span className="font-mono text-xs">{tablePct(slice.pct)}</span>
          </span>
        ))}
      </div>

      <ChartLegend missing={missing} anyPartial={anyPartial} />
    </Card>
  );
}

function pointLabel(snapshot: SnapshotDto, parts: Slice[]): string {
  return (
    `${tableDate(snapshot.takenOn)}, ${tableUsd(snapshot.totalUsd)}: ` +
    parts
      .map((s) => `${CATEGORY_LABEL[s.category]} ${tablePct(s.pct)}`)
      .join(", ") +
    (snapshot.isPartial ? ", частичные данные" : "")
  );
}

function XAxis({
  bars,
  count,
  className,
}: {
  bars: { snapshot: SnapshotDto; center: number }[];
  count: number;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={cn("relative mt-1.5 h-4", className)}>
      {pickTickIndices(bars.length, count).map((i) => (
        <span
          key={bars[i].snapshot.takenOn}
          style={{ left: `${bars[i].center}%` }}
          className="absolute -translate-x-1/2 font-mono text-[10px] whitespace-nowrap text-muted-foreground"
        >
          {tableDate(bars[i].snapshot.takenOn)}
        </span>
      ))}
    </div>
  );
}
