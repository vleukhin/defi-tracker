"use client";

import { useState } from "react";
import { DcCard, SectionHead } from "@/components/dc/card";
import { ASSET_COLOR } from "@/components/dc/protocols";
import { TRADE_CATEGORIES } from "@/components/trades/categories";
import type { PortfolioCategory, SnapshotDto } from "@/lib/api/types";
import { NBSP, dcUsd, tableDate, tablePct } from "@/lib/format";
import {
  bandCenter,
  bandLeft,
  countMissingDays,
  hitRegions,
  splitRuns,
  timeScale,
} from "./chart-geometry";
import {
  ChartNote,
  ChartTimeAxis,
  ChartTooltip,
  HoverLayer,
  PartialMarker,
} from "./chart-parts";
import { HISTORY_CATEGORY_LABEL } from "./labels";

/**
 * График пропорций трёх категорий во времени на КАЛЕНДАРНОЙ оси (S3.2):
 * при редкой истории — стековые полосы на 100% по одной на снепшот,
 * при плотной — стековая area по отрезкам подряд идущих дней (столбец
 * шириной в полпикселя даёт только рябь швов).
 *
 * Цвета — только активов (дизайн-код §5, «полосы данных»); в обоих режимах
 * пропущенные дни остаются пустыми колонками, а area рвётся между
 * отрезками: разрыв виден сам собой, без интерполяции.
 */

/** Порог перехода «столбцы → area», в днях периода. */
const DENSE_SPAN = 45;

const COMPOSITION_HINT =
  "Доли категорий в стоимости портфеля на каждую дату. Пропорции показывают, куда сместился капитал, — количества монет при этом могли не меняться.";

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
  // Пока столбцы различимы глазом — столбцы с зазором; дальше стековая
  // area: на дневной полосе в полпикселя столбцы дают только рябь швов
  const dense = scale.span > DENSE_SPAN;
  // Единственный снепшот занимает всю ширину: узкий столбец по центру
  // выглядел бы обрезком графика, а не составом на дату
  const barWidth = snapshots.length === 1 ? scale.slot : scale.slot * 0.82;
  const barOffset = (scale.slot - barWidth) / 2;

  const bars = snapshots.map((snapshot) => ({
    snapshot,
    left: bandLeft(scale, snapshot.takenOn) + barOffset,
    center: bandCenter(scale, snapshot.takenOn),
    slices: slices(snapshot),
    empty: snapshot.totalUsd === 0,
  }));
  // Отрезки подряд идущих дней: area рисуется по каждому отдельно,
  // через пропущенные дни лента не протягивается (S3.2)
  const runs = splitRuns(
    bars.map((bar, i) => ({ ...bar, takenOn: snapshots[i].takenOn })),
  );

  const axisPoints = bars.map((bar) => ({
    takenOn: bar.snapshot.takenOn,
    x: bar.center,
  }));
  const missing = countMissingDays(snapshots);
  const anyPartial = snapshots.some((s) => s.isPartial);
  const zones = hitRegions(bars.map((b) => b.center));
  const lastSlices = bars[bars.length - 1].slices;

  const ariaLabel =
    `Пропорции категорий, ${periodLabel}. ` +
    `На ${tableDate(snapshots[snapshots.length - 1].takenOn)}: ` +
    lastSlices
      .map((s) => `${HISTORY_CATEGORY_LABEL[s.category]} ${tablePct(s.pct)}`)
      .join(", ") +
    (missing > 0 ? `. Дней без снепшота: ${missing}` : "");

  return (
    <DcCard as="section">
      <SectionHead
        title="Пропорции категорий"
        hint={COMPOSITION_HINT}
        className="border-line border-b"
        action={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {lastSlices.map((slice) => (
              <span
                key={slice.category}
                className="inline-flex items-center gap-1.5"
              >
                <span
                  aria-hidden
                  className="size-[7px] shrink-0 rounded-full"
                  style={{ background: ASSET_COLOR[slice.category] }}
                />
                <span className="t-meta text-text-2">
                  {HISTORY_CATEGORY_LABEL[slice.category]}
                </span>
                <span className="t-meta font-mono">{tablePct(slice.pct)}</span>
              </span>
            ))}
          </div>
        }
      />

      <div className="bg-sunken px-4 pt-3">
        {/* Полоса меток частичных точек — над столбцами, на фоне блока:
            поверх заливки категорий полая метка была бы неразличима */}
        <div className="relative h-3">
          {bars.map((bar) =>
            bar.snapshot.isPartial ? (
              <span
                key={`partial-${bar.snapshot.takenOn}`}
                title="частичные данные"
                style={{ left: `${bar.center}%` }}
                className="absolute top-0 -translate-x-1/2"
              >
                <PartialMarker className="block" />
              </span>
            ) : null,
          )}
        </div>

        <div className="relative h-[88px] overflow-hidden rounded-[6px] sm:h-[104px]">
          <svg
            role="img"
            aria-label={ariaLabel}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
          >
            {dense
              ? runs.map((run) =>
                  run.length < 2 ? (
                    <StackedBar
                      key={run[0].takenOn}
                      bar={run[0]}
                      width={barWidth}
                    />
                  ) : (
                    <StackedArea key={run[0].takenOn} run={run} />
                  ),
                )
              : bars.map((bar) => (
                  <StackedBar
                    key={bar.snapshot.takenOn}
                    bar={bar}
                    width={barWidth}
                  />
                ))}
          </svg>

          <HoverLayer
            zones={zones.map((zone, i) => ({
              ...zone,
              label: pointLabel(bars[i].snapshot, bars[i].slices),
            }))}
            onActive={setActive}
          />

          {active !== null && (
            <ChartTooltip x={bars[active].center}>
              <span className="font-mono text-text-2">
                {tableDate(snapshots[active].takenOn)}
              </span>
              <span className="mt-1 grid gap-0.5">
                {bars[active].slices.map((slice) => (
                  <span
                    key={slice.category}
                    className="flex items-center gap-1.5"
                  >
                    <span
                      aria-hidden
                      className="size-[7px] shrink-0 rounded-full"
                      style={{ background: ASSET_COLOR[slice.category] }}
                    />
                    <span>{HISTORY_CATEGORY_LABEL[slice.category]}</span>
                    <span className="ml-auto pl-2 font-mono">
                      {tablePct(slice.pct)}
                    </span>
                  </span>
                ))}
              </span>
              {snapshots[active].isPartial && (
                <span className="mt-1 block text-warn">частичные данные</span>
              )}
            </ChartTooltip>
          )}
        </div>

        <ChartTimeAxis points={axisPoints} className="pt-[9px] pb-[13px]" />
      </div>

      <ChartNote
        missing={missing}
        anyPartial={anyPartial}
        className="border-line border-t px-card py-3"
      />
    </DcCard>
  );
}

interface Bar {
  snapshot: SnapshotDto;
  left: number;
  center: number;
  slices: Slice[];
  empty: boolean;
}

/** Кумулятивные границы полос сверху вниз: [0, btc, btc+eth, 100]. */
function stackBounds(parts: Slice[]): number[] {
  return parts.reduce<number[]>(
    (acc, part) => [...acc, acc[acc.length - 1] + part.pct],
    [0],
  );
}

/** Столбец на 100%: доли стопкой сверху вниз в порядке категорий. */
function StackedBar({ bar, width }: { bar: Bar; width: number }) {
  if (bar.empty) {
    return (
      <rect
        x={bar.left}
        y={0}
        width={width}
        height={100}
        fill="var(--bg-raised)"
      />
    );
  }
  const bounds = stackBounds(bar.slices);
  return (
    <g>
      {bar.slices.map((slice, k) =>
        slice.pct <= 0 ? null : (
          <rect
            key={slice.category}
            x={bar.left}
            y={bounds[k]}
            width={width}
            height={slice.pct}
            fill={ASSET_COLOR[slice.category]}
          />
        ),
      )}
    </g>
  );
}

/** Стековая area по отрезку подряд идущих дней. */
function StackedArea({ run }: { run: Bar[] }) {
  const bounds = run.map((bar) => stackBounds(bar.slices));

  return (
    <g>
      {run[0].slices.map((slice, k) => {
        const top = run.map((bar, i) => `${bar.center},${bounds[i][k]}`);
        const bottom = run
          .map((bar, i) => `${bar.center},${bounds[i][k + 1]}`)
          .reverse();
        return (
          <polygon
            key={slice.category}
            points={[...top, ...bottom].join(" ")}
            fill={ASSET_COLOR[slice.category]}
          />
        );
      })}
    </g>
  );
}

function pointLabel(snapshot: SnapshotDto, parts: Slice[]): string {
  return (
    `${tableDate(snapshot.takenOn)},${NBSP}${dcUsd(snapshot.totalUsd)}: ` +
    parts
      .map((s) => `${HISTORY_CATEGORY_LABEL[s.category]} ${tablePct(s.pct)}`)
      .join(", ") +
    (snapshot.isPartial ? ", частичные данные" : "")
  );
}
