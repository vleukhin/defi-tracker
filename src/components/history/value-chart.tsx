"use client";

import { useState } from "react";
import { DcCard } from "@/components/dc/card";
import { HelpTip } from "@/components/dc/help-tip";
import type { SnapshotDto } from "@/lib/api/types";
import {
  NBSP,
  dcUsd,
  dcUsdSigned,
  tableDate,
  tablePctSigned,
} from "@/lib/format";
import { periodDelta } from "@/lib/portfolio/period-delta";
import { cn } from "@/lib/utils";
import {
  bandCenter,
  countMissingDays,
  hitRegions,
  splitRuns,
  timeScale,
  yPercent,
} from "./chart-geometry";
import {
  ChartArea,
  ChartNote,
  ChartTimeAxis,
  ChartTooltip,
  HoverLayer,
  PartialMarker,
  valueDomain,
} from "./chart-parts";

/**
 * Главная карточка «Истории» (README, экран 5): подпись + стоимость
 * Mono 34px + дельта за период + максимум/минимум, ниже график высотой
 * 190px на фоне --bg-sunken и ось дат.
 *
 * Линия — --text-1 с заливкой градиентом 16% → 0, сетка не рисуется
 * (дизайн-код §5). Разрывы: каждый отрезок подряд идущих дней — отдельный
 * path, через дни без снепшота линия НЕ проводится (S3.2).
 */

/** Методика — под «?», в потоке её быть не должно (дизайн-код §1.3). */
const METHOD_HINT =
  "Стоимость портфеля на момент каждого снепшота. Дни без снепшота остаются разрывами — история не достраивается расчётом.";

export function ValueChart({
  snapshots,
  periodLabel,
}: {
  snapshots: SnapshotDto[];
  /** Развёрнутое название периода: «30 дней», «все время». */
  periodLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const values = snapshots.map((s) => s.totalUsd);
  const last = snapshots[snapshots.length - 1];
  const first = snapshots[0];
  // Дельта считается общей periodDelta (lib/portfolio/period-delta): та же
  // величина показывается в карточке «Динамика стоимости» на «Портфеле»,
  // и три собственных вычитания на трёх экранах уже расходились
  const delta = periodDelta(snapshots, "portfolio");
  const change = delta?.absolute ?? 0;
  const changePct = delta?.percent ?? null;
  const single = snapshots.length < 2;

  const scale = timeScale(snapshots)!;
  const axis = valueDomain(values);
  const plot = snapshots.map((snapshot) => ({
    takenOn: snapshot.takenOn,
    x: bandCenter(scale, snapshot.takenOn),
    y: yPercent(axis, snapshot.totalUsd),
    snapshot,
  }));
  const runs = splitRuns(plot).map((points) => ({
    key: points[0].takenOn,
    points,
  }));
  const zones = hitRegions(plot.map((p) => p.x));
  const missing = countMissingDays(snapshots);
  const anyPartial = snapshots.some((s) => s.isPartial);

  const ariaLabel =
    `Динамика стоимости портфеля, ${periodLabel}: ` +
    `с ${tableDate(first.takenOn)} по ${tableDate(last.takenOn)}, ` +
    `с ${dcUsd(first.totalUsd)} до ${dcUsd(last.totalUsd)}, ` +
    `изменение ${dcUsdSigned(change)}` +
    (changePct === null ? "" : ` (${tablePctSigned(changePct, 1)})`) +
    (missing > 0 ? `. Дней без снепшота: ${missing}` : "") +
    (anyPartial ? ". Часть точек помечена как частичные данные" : "");

  return (
    <DcCard as="section">
      <div className="flex flex-wrap items-end justify-between gap-x-7 gap-y-4 px-5 pt-[18px] pb-3.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="t-label">Стоимость портфеля</span>
            <HelpTip>{METHOD_HINT}</HelpTip>
          </div>
          {/* Единственное крупное число экрана: Mono 34px (README, экран 5) */}
          <p className="t-display-sm">
            {dcUsd(last.totalUsd)}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
          <Summary label={`За ${periodLabel}`}>
            {single ? (
              <span className="text-text-3">—</span>
            ) : (
              <span
                className={cn(
                  change > 0 && "text-profit",
                  change < 0 && "text-loss",
                  change === 0 && "text-text-2",
                )}
              >
                {dcUsdSigned(change)}
                {changePct !== null && (
                  <>
                    {NBSP}·{NBSP}
                    {tablePctSigned(changePct, 1)}
                  </>
                )}
              </span>
            )}
          </Summary>
          <Summary label="Максимум / минимум">
            <span className="text-text-2">
              {dcUsd(Math.max(...values))} / {dcUsd(Math.min(...values))}
            </span>
          </Summary>
        </div>
      </div>

      <div className="border-line border-t bg-sunken px-4 pt-1">
        <div className="relative h-[150px] sm:h-[190px]">
          {single ? (
            // Одна точка — не динамика: линия по ней была бы вымыслом
            <p className="t-meta absolute inset-0 grid place-items-center px-4 text-center text-text-3">
              Одна точка — кривой нужна вторая. Следующий снепшот достроит
              график.
            </p>
          ) : (
            <>
              <ChartArea
                runs={runs}
                color="var(--text-1)"
                fillOpacity={0.16}
                ariaLabel={ariaLabel}
                className="absolute inset-0"
              />

              {/* Маркеры — HTML-слой: в растянутом viewBox круги стали бы
                  овалами. Постоянных точек нет: рисуются только частичные,
                  одиночные (отрезок из одной точки линии не даёт) и активная */}
              {plot.map((point, i) => {
                const partial = point.snapshot.isPartial;
                const isolated = runs.some(
                  (run) => run.points.length === 1 && run.points[0] === point,
                );
                if (!partial && !isolated && active !== i) return null;
                return (
                  <span
                    key={point.takenOn}
                    style={{ left: `${point.x}%`, top: `${point.y}%` }}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                  >
                    {partial ? (
                      <PartialMarker className="block" />
                    ) : (
                      <span
                        aria-hidden
                        className="block size-[7px] rounded-full bg-text-1"
                      />
                    )}
                  </span>
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
                  <span className="font-mono text-text-2">
                    {tableDate(snapshots[active].takenOn)}
                  </span>
                  {NBSP}·{NBSP}
                  <span className="font-mono font-medium">
                    {dcUsd(snapshots[active].totalUsd)}
                  </span>
                  {snapshots[active].isPartial && (
                    <span className="block text-warn">частичные данные</span>
                  )}
                </ChartTooltip>
              )}
            </>
          )}
        </div>

        <ChartTimeAxis points={plot} className="pt-[9px] pb-[13px]" />
      </div>

      <ChartNote
        missing={missing}
        anyPartial={anyPartial}
        className="border-line border-t px-card py-3"
      />
    </DcCard>
  );
}

/** Второстепенная величина в шапке карточки: подпись → значение 19px. */
function Summary({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <span className="t-label">{label}</span>
      <span className="t-metric-sm">{children}</span>
    </div>
  );
}

function pointLabel(snapshot: SnapshotDto): string {
  return (
    `${tableDate(snapshot.takenOn)}: ${dcUsd(snapshot.totalUsd)}` +
    (snapshot.isPartial ? ", частичные данные" : "")
  );
}
