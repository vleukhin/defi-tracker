"use client";

import { DcCard } from "@/components/dc/card";
import { TooltipCard } from "@/components/dc/tooltip-card";
import { HelpTip } from "@/components/dc/help-tip";
import type { DepositDto, SnapshotDto } from "@/lib/api/types";
import { NBSP, dcUsd, dcUsdSigned, tableDate } from "@/lib/format";
import { profitChange, profitSeries } from "@/lib/portfolio/profit-series";
import { cn } from "@/lib/utils";
import { countMissingDays } from "./chart-geometry";
import { ChartNote } from "./chart-parts";
import {
  type RefLine,
  SeriesChart,
  compactValue,
  seriesAxis,
  seriesRows,
} from "./recharts-parts";

/**
 * График Прибыли: Чистая (Активы − Долг) минус Внесено на каждую дату.
 *
 * Все производные строятся ТОЛЬКО из посчитанной серии, а не из snapshots:
 * точки без Прибыли из серии выброшены, и индексы двух массивов
 * не совпадают. Та же дисциплина, что у спарклайнов количеств.
 *
 * Отличия от графика стоимости — два, оба от знакопеременности ряда:
 *  1. Цвет несёт знак: выше нуля --profit, ниже --loss. Это единственное
 *     исключение из «зелёного и красного в графиках не бывает»
 *     (дизайн-код §5) — здесь знак результата и есть содержание ряда.
 *     Заливка висит от НУЛЯ, а не от низа домена, поэтому её площадь равна
 *     величине прибыли, а не расстоянию до края карточки.
 *  2. Ноль всегда в домене и подписан опорной линией. Сетка отвечает
 *     на вопрос «сколько», опорная линия — на вопрос «по какую сторону
 *     безубытка».
 *
 * Вид общий с карточкой «Динамика прибыли» на «Портфеле»
 * (portfolio/profit-sparkline.tsx): одна величина не должна выглядеть
 * по-разному на двух экранах.
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

  // Ноль обязан быть в поле зрения: без него не видно, по какую сторону
  // безубытка идёт кривая — а спрашивают у этого графика именно это
  const axis = seriesAxis(values, [0]);
  const rows = seriesRows(
    points,
    (point) => point.profitUsd,
    (point) => point.isPartial,
  );
  const refLines: RefLine[] = [{ value: 0, label: "0" }];
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

      <div className="border-line border-t bg-sunken px-3 pt-2 pb-2">
        <div className="relative h-[186px] sm:h-[226px]">
          {single ? (
            <p className="t-meta absolute inset-0 grid place-items-center px-4 text-center text-text-3">
              Одна точка — кривой нужна вторая. Следующий снепшот достроит
              график.
            </p>
          ) : (
            <SeriesChart
              rows={rows}
              axis={axis}
              color="var(--profit)"
              signColors
              ariaLabel={ariaLabel}
              formatY={compactValue}
              refLines={refLines}
              renderTooltip={(row) => (
                <TooltipCard
                  title={tableDate(row.takenOn)}
                  note={row.isPartial ? "частичные данные" : undefined}
                >
                  <span
                    className={cn(
                      row.value! > 0 && "text-profit",
                      row.value! < 0 && "text-loss",
                    )}
                  >
                    {dcUsdSigned(row.value!)}
                  </span>
                  {/* Знаковое число без раскладки неаудируемо: из чего
                      именно оно получилось, видно только здесь */}
                  {row.point && (
                    <span className="mt-1 block text-[11.5px] font-normal text-text-2">
                      Чистая {dcUsd(row.point.netUsd)}
                      {NBSP}·{NBSP}Внесено {dcUsd(row.point.depositedUsd)}
                    </span>
                  )}
                </TooltipCard>
              )}
            />
          )}
        </div>
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

/** Место под карточку, пока грузится журнал депозитов. */
function ProfitSkeleton() {
  return (
    <DcCard as="section" aria-hidden>
      <div className="flex flex-col gap-2.5 px-5 pt-[18px] pb-3.5">
        <span className="block h-2.5 w-24 rounded-pill bg-chip" />
        <span className="block h-8 w-44 rounded-pill bg-chip" />
      </div>
      <div className="border-line border-t bg-sunken px-4 py-4">
        <span className="block h-[186px] w-full rounded-pill bg-chip sm:h-[226px]" />
      </div>
    </DcCard>
  );
}
