"use client";

import { useState } from "react";
import { DcCard } from "@/components/dc/card";
import { HelpTip } from "@/components/dc/help-tip";
import type { DepositDto, SnapshotDto } from "@/lib/api/types";
import { NBSP, dcUsd, dcUsdSigned, tableDate } from "@/lib/format";
import { profitChange, profitSeries } from "@/lib/portfolio/profit-series";
import { cn } from "@/lib/utils";
import {
  bandCenter,
  countMissingDays,
  hitRegions,
  splitRuns,
  timeScale,
  yPercent,
  zeroBaseline,
} from "./chart-geometry";
import {
  ChartArea,
  ChartNote,
  ChartRefLine,
  ChartTimeAxis,
  ChartTooltip,
  HoverLayer,
  PartialMarker,
  valueDomain,
} from "./chart-parts";

/**
 * График Прибыли: Чистая (Активы − Долг) минус Внесено на каждую дату.
 *
 * Все производные строятся ТОЛЬКО из посчитанной серии, а не из snapshots:
 * точки без Прибыли из серии выброшены, и индексы двух массивов
 * не совпадают. Та же дисциплина, что у спарклайнов количеств.
 *
 * Отличия от графика стоимости — два, оба вынужденные:
 *  1. Заливки нет. areaPath кладёт основание на низ домена, а не на ноль:
 *     на знакопеременном ряде площадь под отрицательной ветвью читалась бы
 *     как «размер убытка», хотя она — расстояние до края карточки.
 *  2. Рисуется нулевая линия. Дизайн-код §5 запрещает сетку — повторяющиеся
 *     декоративные линии; ноль здесь единственное значение, осмысленное
 *     независимо от данных (точка безубытка), и он в цвете линий, а не
 *     зелёный/красный.
 */

const METHOD_HINT =
  "Чистая стоимость (Активы минус Долг) на дату снепшота минус внесённые " +
  "собственные средства на ту же дату. «Внесено» восстанавливается по журналу " +
  "депозитов: в снепшот оно не пишется, иначе правка старой записи разошлась " +
  "бы с историей. Точки, в которых долг, стоимость позиций или свободные " +
  "заёмные средства не были прочитаны, в график не попадают — Прибыль в них " +
  "неизвестна, а не равна нулю.";

export function ProfitChart({
  snapshots,
  deposits,
  journalError = null,
  periodLabel,
}: {
  snapshots: SnapshotDto[];
  /** null = журнал ещё грузится: считать Прибыль нельзя. */
  deposits: DepositDto[] | null;
  /** Журнал не загрузился — карточка гаснет одна, экран остаётся живым. */
  journalError?: string | null;
  /** Развёрнутое название периода: «30 дней», «все время». */
  periodLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  // Без журнала Прибыль равнялась бы Чистой — кривая, завышенная ровно
  // на все взносы. Рисовать её нельзя ни секунды: скелетон, пока грузится,
  // и честное сообщение, если не загрузился
  if (deposits === null) {
    return journalError === null ? (
      <ProfitSkeleton />
    ) : (
      <DcCard as="section">
        <div className="flex flex-col gap-2 px-card py-5">
          <div className="flex items-center gap-1.5">
            <span className="t-label">Прибыль</span>
            <HelpTip>{METHOD_HINT}</HelpTip>
          </div>
          <p className="t-body text-text-2">
            Не удалось загрузить журнал «Внесено»: {journalError}. Без него
            Прибыль совпала бы с чистой стоимостью — график не строится.
          </p>
        </div>
      </DcCard>
    );
  }

  const points = profitSeries(snapshots, deposits);
  const excluded = snapshots.length - points.length;

  if (points.length === 0) {
    return (
      <DcCard as="section">
        <div className="flex flex-col gap-2 px-card py-5">
          <div className="flex items-center gap-1.5">
            <span className="t-label">Прибыль</span>
            <HelpTip>{METHOD_HINT}</HelpTip>
          </div>
          <p className="t-body max-w-prose text-text-2">
            Прибыль по истории пока не считается: ни в одной точке периода не
            было известно всё, из чего она складывается — долг, стоимость
            размещённых позиций и свободные заёмные средства на кошельках.
          </p>
          <p className="t-meta text-text-3">
            Свободные заёмные средства начали попадать в снепшот только сейчас,
            и задним числом они не восстанавливаются. График начнётся
            со следующего снепшота.
          </p>
        </div>
      </DcCard>
    );
  }

  const values = points.map((p) => p.profitUsd);
  const first = points[0];
  const last = points[points.length - 1];
  const change = profitChange(points);
  const single = points.length < 2;

  const scale = timeScale(points)!;
  const axis = valueDomain(values);
  const zeroY = zeroBaseline(axis);
  const plot = points.map((point) => ({
    takenOn: point.takenOn,
    x: bandCenter(scale, point.takenOn),
    y: yPercent(axis, point.profitUsd),
    point,
  }));
  const runs = splitRuns(plot).map((run) => ({
    key: run[0].takenOn,
    points: run,
  }));
  const zones = hitRegions(plot.map((p) => p.x));
  const missing = countMissingDays(points);
  const anyPartial = points.some((p) => p.isPartial);

  const ariaLabel =
    `Динамика прибыли, ${periodLabel}: ` +
    `с ${tableDate(first.takenOn)} по ${tableDate(last.takenOn)}, ` +
    `с ${dcUsdSigned(first.profitUsd)} до ${dcUsdSigned(last.profitUsd)}` +
    (change === null ? "" : `, изменение ${dcUsdSigned(change.abs)}`) +
    (missing > 0 ? `. Дней без прибыли: ${missing}` : "") +
    (anyPartial ? ". Часть точек помечена как частичные данные" : "");

  return (
    <DcCard as="section">
      <div className="flex flex-wrap items-end justify-between gap-x-7 gap-y-4 px-5 pt-[18px] pb-3.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="t-label">Прибыль</span>
            <HelpTip>{METHOD_HINT}</HelpTip>
          </div>
          {/* Зелёный/красный здесь разрешены: §5 запрещает их ВНУТРИ графика,
              а знак результата — ровно то, для чего эта пара цветов и есть */}
          <p
            className={cn(
              "t-display-sm",
              last.profitUsd > 0 && "text-profit",
              last.profitUsd < 0 && "text-loss",
            )}
          >
            {dcUsdSigned(last.profitUsd)}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
          {/* Процента нет намеренно: база знакопеременная, и «−250 %»
              при переходе от убытка к прибыли — бессмыслица */}
          <Summary label={`За ${periodLabel}`}>
            {change === null ? (
              <span className="text-text-3">—</span>
            ) : (
              <span
                className={cn(
                  change.abs > 0 && "text-profit",
                  change.abs < 0 && "text-loss",
                  change.abs === 0 && "text-text-2",
                )}
              >
                {dcUsdSigned(change.abs)}
              </span>
            )}
          </Summary>
          <Summary label="Максимум / минимум">
            <span className="text-text-2">
              {dcUsdSigned(Math.max(...values))} /{" "}
              {dcUsdSigned(Math.min(...values))}
            </span>
          </Summary>
        </div>
      </div>

      <div className="border-line border-t bg-sunken px-4 pt-1">
        <div className="relative h-[150px] sm:h-[190px]">
          {single ? (
            <p className="t-meta absolute inset-0 grid place-items-center px-4 text-center text-text-3">
              Одна точка — кривой нужна вторая. Следующий снепшот достроит
              график.
            </p>
          ) : (
            <>
              {zeroY !== null && <ChartRefLine y={zeroY} label="0" />}

              <ChartArea
                runs={runs}
                color="var(--text-1)"
                fillOpacity={0}
                ariaLabel={ariaLabel}
                className="absolute inset-0"
              />

              {plot.map((item, i) => {
                const partial = item.point.isPartial;
                const isolated = runs.some(
                  (run) => run.points.length === 1 && run.points[0] === item,
                );
                if (!partial && !isolated && active !== i) return null;
                return (
                  <span
                    key={item.takenOn}
                    style={{ left: `${item.x}%`, top: `${item.y}%` }}
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
                  label: pointLabel(points[i]),
                }))}
                onActive={setActive}
              />

              {active !== null && (
                <ChartTooltip x={plot[active].x}>
                  <span className="font-mono text-text-2">
                    {tableDate(points[active].takenOn)}
                  </span>
                  {NBSP}·{NBSP}
                  <span className="font-mono font-medium">
                    {dcUsdSigned(points[active].profitUsd)}
                  </span>
                  {/* Знаковое число без раскладки неаудируемо: из чего
                      именно оно получилось, видно только здесь */}
                  <span className="block text-text-2">
                    Чистая {dcUsd(points[active].netUsd)}
                    {NBSP}·{NBSP}Внесено {dcUsd(points[active].depositedUsd)}
                  </span>
                  {points[active].isPartial && (
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
        missingLabel="дни без снепшота или без Прибыли"
        extra={
          excluded > 0 ? (
            <span>
              точек без Прибыли:{" "}
              <span className="font-mono">{excluded}</span> — долг, позиции или
              свободные заёмные не читались
            </span>
          ) : null
        }
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

function pointLabel(point: {
  takenOn: string;
  profitUsd: number;
  isPartial: boolean;
}): string {
  return (
    `${tableDate(point.takenOn)}: ${dcUsdSigned(point.profitUsd)}` +
    (point.isPartial ? ", частичные данные" : "")
  );
}

/** Место под карточку, пока грузится журнал депозитов. */
function ProfitSkeleton() {
  return (
    <DcCard as="section" aria-hidden>
      <div className="flex flex-col gap-2.5 px-5 pt-[18px] pb-3.5">
        <span className="block h-2.5 w-24 rounded-pill bg-chip" />
        <span className="block h-8 w-44 rounded-pill bg-chip" />
      </div>
      <div className="border-line border-t bg-sunken px-4 py-4">
        <span className="block h-[150px] w-full rounded-pill bg-chip sm:h-[190px]" />
      </div>
    </DcCard>
  );
}
