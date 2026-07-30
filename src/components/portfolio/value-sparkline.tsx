"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import {
  areaPath,
  bandCenter,
  countMissingDays,
  linePath,
  niceTicks,
  splitRuns,
  timeScale,
  yPercent,
} from "@/components/history/chart-geometry";
import { formatPnl, pnlClass } from "@/components/pnl";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { SnapshotsResponseDto } from "@/lib/api/types";
import { tableDate, tableUsd } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

/**
 * Спарклайн стоимости за 30 дней на дашборде (Фаза 3, S3.2) — на месте
 * заготовки из §5.1.5. Тот же инлайновый SVG и та же геометрия, что на
 * экране «История»: календарная ось X и разрывы на пропущенных днях.
 * Без осей и тултипов — это превью со ссылкой в историю, а не график.
 */

const TITLE = "Динамика стоимости";

export function ValueSparkline() {
  const { data, error, loading } = useApi<SnapshotsResponseDto>(
    "/api/snapshots?period=30d",
  );

  if (loading && !data) {
    return (
      <SparklineCard>
        <Skeleton className="h-[72px] rounded-md sm:h-24" aria-hidden="true" />
      </SparklineCard>
    );
  }

  // Ошибка истории не должна ломать дашборд — карточка просто молчит
  if (error || !data) {
    return (
      <SparklineCard>
        <Hint>История недоступна</Hint>
      </SparklineCard>
    );
  }

  const snapshots = data.snapshots;
  if (snapshots.length < 2) {
    return (
      <SparklineCard>
        <Hint>
          {snapshots.length === 0
            ? "Копим историю — первая точка появится завтра"
            : "Копим историю — вторая точка появится завтра"}
        </Hint>
      </SparklineCard>
    );
  }

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

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const change = last.totalUsd - first.totalUsd;
  const changePct = first.totalUsd === 0 ? null : (change / first.totalUsd) * 100;
  const missing = countMissingDays(snapshots);
  const anyPartial = snapshots.some((s) => s.isPartial);

  const ariaLabel =
    `${TITLE} за 30 дней: с ${tableDate(first.takenOn)} по ` +
    `${tableDate(last.takenOn)}, с ${tableUsd(first.totalUsd)} до ` +
    `${tableUsd(last.totalUsd)}, изменение ${formatPnl(change, changePct)}` +
    (missing > 0 ? `. Дней без снепшота: ${missing}` : "");

  return (
    <Card className="p-0">
      <Link
        href="/history"
        className="block rounded-xl p-4 outline-none transition-colors duration-120 ease-out hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold">{TITLE}</h2>
          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className="font-mono">{tableUsd(last.totalUsd)}</span>
            <span className={cn("font-mono whitespace-nowrap", pnlClass(change))}>
              {formatPnl(change, changePct)}
            </span>
            <span className="hidden sm:inline">за 30 дней</span>
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </p>
        </div>

        <div className="relative mt-2 h-[72px] sm:h-24">
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

          {/* Маркеры — HTML: в растянутом viewBox круги стали бы овалами */}
          {plot.map((point, i) => {
            const partial = point.snapshot.isPartial;
            const isolated = runs.some(
              (run) => run.length === 1 && run[0] === point,
            );
            const isLast = i === plot.length - 1;
            if (!partial && !isolated && !isLast) return null;
            return (
              <span
                key={point.takenOn}
                aria-hidden="true"
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2 rounded-full",
                  partial
                    ? "size-2.5 border-2 border-warning bg-background"
                    : "size-1.5 bg-primary",
                )}
              />
            );
          })}
        </div>

        {(anyPartial || missing > 0) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {anyPartial && "часть точек частичные"}
            {anyPartial && missing > 0 && " · "}
            {missing > 0 && (
              <>
                дней без снепшота: <span className="font-mono">{missing}</span>
              </>
            )}
          </p>
        )}
      </Link>
    </Card>
  );
}

function SparklineCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{TITLE}</h2>
        <Link
          href="/history"
          className="rounded-sm text-xs text-link underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          История →
        </Link>
      </div>
      <div className="mt-2">{children}</div>
    </Card>
  );
}

/** Приглушенная строка вместо сломанного графика (ТЗ §5.1.5 — честно пусто). */
function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-[72px] items-center sm:h-24">
      <div className="w-full border-t border-dashed border-border" />
      <p className="absolute left-1/2 -translate-x-1/2 bg-card px-2 text-center text-xs text-muted-foreground">
        {children}
      </p>
    </div>
  );
}
