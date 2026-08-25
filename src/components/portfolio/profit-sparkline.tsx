"use client";

import Link from "next/link";
import { countMissingDays } from "@/components/history/chart-geometry";
import {
  SeriesChart,
  compactValue,
  seriesAxis,
  seriesRows,
} from "@/components/history/recharts-parts";
import { DcCard } from "@/components/dc/card";
import { HelpTip } from "@/components/dc/help-tip";
import { TooltipCard } from "@/components/dc/tooltip-card";
import type { DepositDto, SnapshotsResponseDto } from "@/lib/api/types";
import { NBSP, dcUsd, dcUsdSigned, tableDate } from "@/lib/format";
import { profitChange, profitSeries } from "@/lib/portfolio/profit-series";
import { cn } from "@/lib/utils";

/**
 * «Динамика прибыли» за 30 дней — превью со ссылкой в историю.
 *
 * Единственный график приложения, где цвет несёт результат: выше нуля
 * зелёный, ниже красный (дизайн-код §5). У знакопеременного ряда знак —
 * это и есть содержание, а не украшение поверх данных. Заливка висит
 * от нулевой линии, поэтому её площадь равна величине прибыли, а не
 * расстоянию до края карточки.
 *
 * Крупное число — ПОСЛЕДНЯЯ ТОЧКА РЯДА, то есть прибыль на конец дня
 * последнего снепшота. «Прибыль» в шапке экрана считается на сейчас
 * и с этим числом не совпадёт — как уже не совпадают «Активы» в шапке
 * и «портфель» у «Динамики стоимости». Оба подписаны тем, что показывают.
 */

const TITLE = "Динамика прибыли";
const SUBTITLE = "прибыль на конец дня · за 30 дней";
const CHART_HEIGHT = 186;

const METHOD_HINT =
  "Чистая стоимость (Активы минус Долг) на дату снепшота минус внесённые " +
  "собственные средства на ту же дату. «Внесено» восстанавливается по журналу " +
  "депозитов, а не берётся из снепшота. Точки, в которых долг, стоимость " +
  "позиций или свободные заёмные средства не были прочитаны, в график " +
  "не попадают — Прибыль в них неизвестна, а не равна нулю.";

export function ProfitSparkline({
  data,
  loading,
  error,
  deposits,
  depositsError,
}: {
  data: SnapshotsResponseDto | null;
  loading: boolean;
  error: string | null;
  /** null = журнал ещё грузится либо не загрузился: считать Прибыль нельзя. */
  deposits: DepositDto[] | null;
  depositsError: string | null;
}) {
  if ((loading && !data) || (deposits === null && depositsError === null)) {
    return (
      <ChartCard>
        <div aria-hidden className="bg-chip" style={{ height: CHART_HEIGHT }} />
      </ChartCard>
    );
  }

  // Без журнала Прибыль равнялась бы Чистой — кривая, завышенная ровно
  // на все взносы. Гаснет одна карточка, экран остаётся живым
  if (deposits === null) {
    return (
      <ChartCard>
        <Placeholder>
          Не удалось загрузить журнал «Внесено»: {depositsError}
        </Placeholder>
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

  const points = profitSeries(data.snapshots, deposits);
  const excluded = data.snapshots.length - points.length;

  if (points.length < 2) {
    return (
      <ChartCard>
        <Placeholder>
          {points.length === 0
            ? "Прибыль по истории пока не считается: ни в одной точке не было известно всё, из чего она складывается"
            : "Одна точка — кривой нужна вторая. Следующий снепшот достроит график."}
        </Placeholder>
      </ChartCard>
    );
  }

  const values = points.map((p) => p.profitUsd);
  // Ноль обязан быть в поле зрения: без него не видно, по какую сторону
  // безубытка идёт кривая — а спрашивают у этого графика именно это
  const axis = seriesAxis(values, [0]);
  const rows = seriesRows(
    points,
    (point) => point.profitUsd,
    (point) => point.isPartial,
  );

  const first = points[0];
  const last = points[points.length - 1];
  const change = profitChange(points);
  const missing = countMissingDays(points);
  const anyPartial = points.some((p) => p.isPartial);

  const ariaLabel =
    `${TITLE} за 30 дней: с ${tableDate(first.takenOn)} по ` +
    `${tableDate(last.takenOn)}, с ${dcUsdSigned(first.profitUsd)} до ` +
    `${dcUsdSigned(last.profitUsd)}` +
    (change === null ? "" : `, изменение ${dcUsdSigned(change.abs)}`) +
    (missing > 0 ? `. Дней без Прибыли: ${missing}` : "");

  return (
    <ChartCard
      value={last.profitUsd}
      change={change?.abs}
      note={
        [
          anyPartial ? "часть точек частичные" : null,
          missing > 0 ? `дней без Прибыли: ${missing}` : null,
          excluded > 0 ? `точек без Прибыли: ${excluded}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      }
    >
      <div className="px-3 pt-2 pb-2" style={{ height: CHART_HEIGHT }}>
        <SeriesChart
          rows={rows}
          axis={axis}
          color="var(--profit)"
          signColors
          ariaLabel={ariaLabel}
          formatY={compactValue}
          refLines={[{ value: 0, label: "0" }]}
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
              {/* Знаковое число без раскладки неаудируемо: из чего именно
                  оно получилось, видно только здесь */}
              {row.point && (
                <span className="mt-1 block text-[11.5px] font-normal text-text-2">
                  Чистая {dcUsd(row.point.netUsd)}
                  {NBSP}·{NBSP}Внесено {dcUsd(row.point.depositedUsd)}
                </span>
              )}
            </TooltipCard>
          )}
        />
      </div>
    </ChartCard>
  );
}

/** Каркас карточки: шапка с числом и дельтой, ниже область графика. */
function ChartCard({
  value,
  change,
  note,
  children,
}: {
  value?: number;
  change?: number;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <DcCard>
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2 px-5 pt-4 pb-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="t-h3">{TITLE}</h2>
            <HelpTip>{METHOD_HINT}</HelpTip>
          </div>
          <p className="t-meta mt-1 text-text-3">
            {SUBTITLE}
            {note ? ` · ${note}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          {value !== undefined && (
            <span
              className={cn(
                "font-mono text-[19px] font-medium tracking-[-0.02em]",
                value > 0 && "text-profit",
                value < 0 && "text-loss",
              )}
            >
              {dcUsdSigned(value)}
            </span>
          )}
          {/* Процента нет намеренно: база знакопеременная, и «−250 %»
              при переходе от убытка к прибыли — бессмыслица */}
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
      className="flex items-center justify-center px-5 text-center text-[12.5px] text-text-3"
      style={{ height: CHART_HEIGHT }}
    >
      {children}
    </div>
  );
}
