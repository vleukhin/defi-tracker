"use client";

import Link from "next/link";
import {
  areaPath,
  bandCenter,
  countMissingDays,
  linePath,
  splitRuns,
  timeScale,
  yPercent,
} from "@/components/history/chart-geometry";
import { ChartTimeAxis, valueDomain } from "@/components/history/chart-parts";
import { DcCard } from "@/components/dc/card";
import type { SnapshotsResponseDto } from "@/lib/api/types";
import { dcUsd, dcUsdSigned, tableDate, tablePctSigned } from "@/lib/format";
import {
  PORTFOLIO_DELTA_LABEL,
  periodDelta,
} from "@/lib/portfolio/period-delta";
import { cn } from "@/lib/utils";

/**
 * «Динамика стоимости» за 30 дней — превью со ссылкой в историю, а не
 * полноценный график: осей значений и тултипов здесь нет.
 *
 * Линия набрана цветом текста, а не семантикой (§5): падение портфеля —
 * это данные, а не убыток по позиции, и красная линия врала бы про роль
 * цвета. Пропущенные дни остаются разрывами: прямая через две недели
 * без снепшотов — ложь о данных, которых не существует.
 */

const TITLE = "Динамика стоимости";
const CHART_HEIGHT = 150;
const GRADIENT_ID = "dc-value-area";

export function ValueSparkline({
  data,
  loading,
  error,
}: {
  data: SnapshotsResponseDto | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !data) {
    return (
      <ChartCard>
        <div aria-hidden className="bg-chip" style={{ height: CHART_HEIGHT }} />
      </ChartCard>
    );
  }

  if (error || !data) {
    return (
      <ChartCard>
        <Placeholder>История недоступна</Placeholder>
      </ChartCard>
    );
  }

  const snapshots = data.snapshots;
  if (snapshots.length < 2) {
    return (
      <ChartCard>
        <Placeholder>
          {snapshots.length === 0
            ? "Копим историю — первая точка появится завтра"
            : "Копим историю — вторая точка появится завтра"}
        </Placeholder>
      </ChartCard>
    );
  }

  const scale = timeScale(snapshots)!;
  const values = snapshots.map((s) => s.totalUsd);
  // Тот же домен, что у полноценного графика «Истории»: niceTicks округлял
  // границы под сетку, которой здесь нет, и один и тот же ряд получал на
  // двух экранах разную форму кривой
  const axis = valueDomain(values);
  const plot = snapshots.map((snapshot) => ({
    takenOn: snapshot.takenOn,
    x: bandCenter(scale, snapshot.takenOn),
    y: yPercent(axis, snapshot.totalUsd),
    snapshot,
  }));
  const runs = splitRuns(plot);

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  // Общая periodDelta, а не собственное вычитание: hero над этой карточкой
  // считает по «активам», здесь — по портфелю, и раньше оба числа стояли
  // рядом под одинаковой подписью «за 30 дней»
  const delta = periodDelta(snapshots, "portfolio");
  const change = delta?.absolute ?? 0;
  const changePct = delta?.percent ?? null;
  const missing = countMissingDays(snapshots);
  const anyPartial = snapshots.some((s) => s.isPartial);

  const ariaLabel =
    `${TITLE} за 30 дней: с ${tableDate(first.takenOn)} по ` +
    `${tableDate(last.takenOn)}, с ${dcUsd(first.totalUsd)} до ` +
    `${dcUsd(last.totalUsd)}, изменение ${dcUsdSigned(change)}` +
    (missing > 0 ? `. Дней без снепшота: ${missing}` : "");

  return (
    <ChartCard
      value={dcUsd(last.totalUsd)}
      change={change}
      changePct={changePct}
      note={
        anyPartial || missing > 0
          ? [
              anyPartial ? "часть точек частичные" : null,
              missing > 0 ? `дней без снепшота: ${missing}` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined
      }
    >
      <div className="relative px-1" style={{ height: CHART_HEIGHT }}>
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--text-1)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--text-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {runs.map((run) => (
            <path
              key={`area-${run[0].takenOn}`}
              d={areaPath(run)}
              fill={`url(#${GRADIENT_ID})`}
            />
          ))}
          {runs.map((run) => (
            <path
              key={`line-${run[0].takenOn}`}
              d={linePath(run)}
              fill="none"
              stroke="var(--text-1)"
              strokeWidth={1}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {/* Маркеры — HTML: в растянутом viewBox круги стали бы овалами.
            Помечаются только точки, о которых надо знать: частичные и
            одиночные, у которых линии нет вовсе */}
        {plot.map((point) => {
          const partial = point.snapshot.isPartial;
          const isolated = runs.some(
            (run) => run.length === 1 && run[0] === point,
          );
          if (!partial && !isolated) return null;
          return (
            <span
              key={point.takenOn}
              aria-hidden="true"
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
              className={cn(
                "-translate-x-1/2 -translate-y-1/2 absolute rounded-full",
                partial
                  ? "size-[9px] border-2 border-warn bg-sunken"
                  : "size-[5px] bg-text-1",
              )}
            />
          );
        })}
      </div>

      {/* Ось строится по фактическим x точек. Раньше подписи раскладывал
          justify-between, то есть равномерно, — и они не совпадали с точками,
          к которым относились. */}
      <ChartTimeAxis points={plot} className="px-5 pt-2 pb-3" />
    </ChartCard>
  );
}

/** Каркас карточки: шапка с числом и дельтой, ниже область графика. */
function ChartCard({
  value,
  change,
  changePct,
  note,
  children,
}: {
  value?: string;
  change?: number;
  changePct?: number | null;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <DcCard>
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2 px-5 pt-4 pb-3">
        <div>
          <h2 className="t-h3">{TITLE}</h2>
          <p className="t-meta mt-1 text-text-3">
            {PORTFOLIO_DELTA_LABEL}
            {note ? ` · ${note}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          {value && (
            <span className="font-mono text-[19px] font-medium tracking-[-0.02em]">
              {value}
            </span>
          )}
          {change !== undefined && (
            <span
              className={cn(
                "text-[13px] font-medium whitespace-nowrap",
                change > 0 && "text-profit",
                change < 0 && "text-loss",
                change === 0 && "text-text-2",
              )}
            >
              {dcUsdSigned(change)}
              {changePct != null && ` · ${tablePctSigned(changePct, 1)}`}
            </span>
          )}
          <Link
            href="/history"
            className="t-meta rounded-pill text-text-3 outline-none transition-colors duration-120 ease-out hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            вся история →
          </Link>
        </div>
      </div>
      <div className="border-line border-t bg-sunken">{children}</div>
    </DcCard>
  );
}

/** Честно пустая область вместо сломанного графика. */
function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-center px-5 text-[12.5px] text-text-3"
      style={{ height: CHART_HEIGHT }}
    >
      {children}
    </div>
  );
}
