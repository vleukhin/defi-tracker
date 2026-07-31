"use client";

import { useState } from "react";
import { pnlClass } from "@/components/pnl";
import { Card } from "@/components/ui/card";
import type { SnapshotDto } from "@/lib/api/types";
import {
  tableDate,
  tablePctSigned,
  tableUsd,
  tableUsdSigned,
  usdDecimals,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ChartLegend,
  ChartTimeAxis,
  ChartTooltip,
  HoverLayer,
} from "./chart-parts";
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

/**
 * График общей стоимости портфеля (S3.2). Инлайновый SVG: viewBox 0…100
 * по обеим осям + preserveAspectRatio="none" — график тянется по ширине
 * контейнера без замеров DOM; толщина линии удерживается
 * vector-effect="non-scaling-stroke", а маркеры и подписи вынесены в
 * HTML-слой, чтобы их не растягивало вместе с координатной сеткой.
 *
 * Разрывы: каждый отрезок подряд идущих дней — отдельный path. Через дни
 * без снепшота линия НЕ проводится (S3.2).
 */

/** Сплошные точки при небольшом числе снепшотов; дальше — только линия. */
const DOTS_LIMIT = 45;

export function ValueChart({
  snapshots,
  periodLabel,
}: {
  snapshots: SnapshotDto[];
  periodLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const scale = timeScale(snapshots)!;
  const values = snapshots.map((s) => s.totalUsd);
  const axis = niceTicks(Math.min(...values), Math.max(...values));

  const plot = snapshots.map((snapshot) => ({
    takenOn: snapshot.takenOn,
    x: bandCenter(scale, snapshot.takenOn),
    y: yPercent(axis, snapshot.totalUsd),
    snapshot,
  }));
  const runs = splitRuns(plot);
  const zones = hitRegions(plot.map((p) => p.x));
  const missing = countMissingDays(snapshots);
  const anyPartial = snapshots.some((s) => s.isPartial);

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const change = last.totalUsd - first.totalUsd;
  const changePct =
    first.totalUsd === 0 ? null : (change / first.totalUsd) * 100;

  const ariaLabel =
    `Динамика стоимости портфеля, ${periodLabel}: ` +
    `с ${tableDate(first.takenOn)} по ${tableDate(last.takenOn)}, ` +
    `с ${tableUsd(first.totalUsd)} до ${tableUsd(last.totalUsd)}, ` +
    `изменение ${tableUsdSigned(change)}` +
    (changePct === null ? "" : ` (${tablePctSigned(changePct, 1)})`) +
    (missing > 0 ? `. Дней без снепшота: ${missing}` : "") +
    (anyPartial ? ". Часть точек помечена как частичные данные" : "");

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">Стоимость портфеля</h2>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{tableUsd(last.totalUsd)}</span>
          {snapshots.length > 1 && (
            <>
              {" · "}
              <span className={cn("font-mono", pnlClass(change))}>
                {tableUsdSigned(change, usdDecimals(change))}
                {changePct !== null && ` (${tablePctSigned(changePct, 1)})`}
              </span>{" "}
              за период
            </>
          )}
        </p>
      </div>

      <div className="relative mt-3 pl-14 sm:pl-16">
        <div className="relative h-44 sm:h-56">
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
                  {tableUsd(tick, usdDecimals(tick))}
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
                fill="var(--primary)"
                opacity={0.14}
              />
            ))}
            {runs.map((run) => (
              <path
                key={`line-${run[0].takenOn}`}
                d={linePath(run)}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {/* Маркеры — HTML-слой: в растянутом viewBox круги стали бы овалами */}
          {plot.map((point, i) => {
            const partial = point.snapshot.isPartial;
            const isolated = runs.some(
              (run) => run.length === 1 && run[0] === point,
            );
            const show =
              partial ||
              isolated ||
              active === i ||
              snapshots.length <= DOTS_LIMIT;
            if (!show) return null;
            return (
              <span
                key={point.takenOn}
                aria-hidden="true"
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2 rounded-full",
                  partial
                    ? // Частичная точка отличается ФОРМОЙ (полая), а не только цветом
                      "size-2.5 border-2 border-warning bg-background"
                    : "size-1.5 bg-primary",
                  active === i && !partial && "size-2.5 ring-2 ring-primary/30",
                )}
              />
            );
          })}

          <HoverLayer
            zones={zones.map((zone, i) => ({
              ...zone,
              label: pointLabel(snapshots[i]),
            }))}
            onActive={setActive}
          />

          {active !== null && (
            <ChartTooltip x={plot[active].x}>
              <span className="font-mono">
                {tableDate(snapshots[active].takenOn)}
              </span>
              {" · "}
              <span className="font-mono font-medium">
                {tableUsd(snapshots[active].totalUsd)}
              </span>
              {snapshots[active].isPartial && (
                <span className="block text-warning">частичные данные</span>
              )}
            </ChartTooltip>
          )}
        </div>

        {/* Подписи оси X: на узких экранах их меньше — даты не наезжают */}
        <ChartTimeAxis points={plot} />
      </div>

      <ChartLegend missing={missing} anyPartial={anyPartial} />
    </Card>
  );
}

function pointLabel(snapshot: SnapshotDto): string {
  return (
    `${tableDate(snapshot.takenOn)}: ${tableUsd(snapshot.totalUsd)}` +
    (snapshot.isPartial ? ", частичные данные" : "")
  );
}
