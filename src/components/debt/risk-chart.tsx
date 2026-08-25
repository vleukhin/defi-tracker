"use client";

import { useState } from "react";
import { DcCard } from "@/components/dc/card";
import { HelpTip } from "@/components/dc/help-tip";
import { Segmented } from "@/components/dc/segmented";
import { TooltipCard } from "@/components/dc/tooltip-card";
import { countMissingDays } from "@/components/history/chart-geometry";
import { ChartNote } from "@/components/history/chart-parts";
import {
  type RefLine,
  SeriesChart,
  seriesAxis,
  seriesRows,
} from "@/components/history/recharts-parts";
import {
  PeriodSwitcher,
  periodFull,
} from "@/components/history/period-switcher";
import type { SnapshotDto, SnapshotPeriod } from "@/lib/api/types";
import { tableDate, tableNumber, tablePct, tableSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatHfThreshold } from "./hf";
import { hfTone } from "./risk";
import {
  type RiskMetric,
  riskChange,
  riskSeries,
  worstValue,
} from "./risk-series";

/**
 * История риска на экране «Долг»: health factor и LTV по дневным снепшотам.
 *
 * ОДНА КАРТОЧКА С ПЕРЕКЛЮЧАТЕЛЕМ, а не два графика рядом: HF и LTV — две
 * проекции одного и того же плеча (HF = LT / LTV), и рядом они рисовали бы
 * зеркальные кривые, между которыми глаз всё равно выбирает одну.
 *
 * Гранулярность дневная — та же, что у снепшотов. Между точками HF может
 * проваливаться и возвращаться: за этим следит крон здоровья каждые
 * 15 минут и уведомления, а не этот график. Он отвечает на другой вопрос —
 * куда плечо едет неделями.
 *
 * Точки, в которых нужной величины не было, из серии выброшены (см.
 * risk-series): день без HF перестаёт быть соседним по календарю, и линия
 * рвётся сама.
 */

const HF_HINT =
  "Минимальный health factor по паре (кошелёк, сеть) на момент дневного " +
  "снепшота: ликвидация приходит к худшей позиции, а не к портфелю в среднем. " +
  "Дни без долга («∞») и дни, в которые здоровье не читалось, в график " +
  "не попадают. Внутридневные провалы сюда не видны — за ними следит " +
  "проверка каждые 15 минут и уведомления.";

const LTV_HINT =
  "Долг, делённый на залог, на момент дневного снепшота. Оба числа — " +
  "по оракулу Aave (тот же базис, что у самого протокола), поэтому " +
  "отношение сходится с экраном. День, в который залог не читался, " +
  "в график не попадает.";

const METRIC_OPTIONS: { value: RiskMetric; label: string }[] = [
  { value: "hf", label: "HF" },
  { value: "ltv", label: "LTV" },
];

export function RiskChart({
  snapshots,
  loading,
  error,
  period,
  onPeriodChange,
  threshold,
  targetLtvPct,
  liquidationLtvPct,
}: {
  snapshots: SnapshotDto[] | null;
  loading: boolean;
  error: string | null;
  period: SnapshotPeriod;
  onPeriodChange: (period: SnapshotPeriod) => void;
  /** Порог предупреждения HF из настроек — опорная линия графика HF. */
  threshold: number;
  /** Целевой LTV из настроек — опорная линия графика LTV. */
  targetLtvPct: number;
  /**
   * LTV, при котором наступает ликвидация — по ТЕКУЩЕМУ составу залога.
   * Историческую LT мы не храним, поэтому линия рисуется как ориентир
   * и только если попадает в поле графика. null = состав неизвестен.
   */
  liquidationLtvPct: number | null;
}) {
  const [metric, setMetric] = useState<RiskMetric>("hf");

  const periodLabel = periodFull(period);
  const points = snapshots === null ? [] : riskSeries(snapshots, metric);
  const excluded = (snapshots?.length ?? 0) - points.length;

  const head = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-card pt-4 pb-3">
      <div className="flex items-center gap-1.5">
        <h2 className="t-label">История риска</h2>
        <HelpTip>{metric === "hf" ? HF_HINT : LTV_HINT}</HelpTip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          options={METRIC_OPTIONS}
          value={metric}
          onChange={setMetric}
          ariaLabel="Метрика риска"
        />
        <PeriodSwitcher period={period} onChange={onPeriodChange} />
      </div>
    </div>
  );

  if (snapshots === null || points.length < 2) {
    return (
      <DcCard as="section">
        {head}
        <div className="border-line border-t px-card py-5">
          <p className="t-body max-w-prose text-text-2">
            <Empty
              loading={loading}
              error={error}
              metric={metric}
              periodLabel={periodLabel}
              snapshots={snapshots?.length ?? 0}
              points={points.length}
            />
          </p>
        </div>
      </DcCard>
    );
  }

  const values = points.map((p) => p.value);
  const last = points[points.length - 1];
  const first = points[0];
  const change = riskChange(points);
  const worst = worstValue(points, metric)!;

  // Граница решения обязана быть в поле зрения; уровень ликвидации —
  // только если сам туда попадает, иначе кривая расплющится
  const decision = metric === "hf" ? threshold : targetLtvPct;
  const liquidation = metric === "hf" ? 1 : liquidationLtvPct;

  const axis = seriesAxis(values, [decision]);
  const rows = seriesRows(
    points,
    (point) => point.value,
    (point) => point.isPartial,
  );

  const refLines: RefLine[] = [
    {
      value: decision,
      label:
        metric === "hf"
          ? `порог ${formatHfThreshold(threshold)}`
          : `цель ${tablePct(targetLtvPct, 0)}`,
    },
  ];
  // Уровень ликвидации в домен не раздвигается и рисуется, только если сам
  // в него попал: иначе кривая расплющится в прямую у края поля
  if (liquidation !== null && liquidation >= axis.min && liquidation <= axis.max) {
    refLines.push({
      value: liquidation,
      dashed: true,
      label: `ликвидация ${metric === "hf" ? "1,00" : tablePct(liquidation, 0)}`,
    });
  }

  const missing = countMissingDays(points);
  const anyPartial = points.some((p) => p.isPartial);

  const ariaLabel =
    `Динамика ${metric === "hf" ? "health factor" : "LTV"}, ${periodLabel}: ` +
    `с ${tableDate(first.takenOn)} по ${tableDate(last.takenOn)}, ` +
    `с ${fmt(first.value, metric)} до ${fmt(last.value, metric)}` +
    (change === null ? "" : `, изменение ${fmtSigned(change.abs, metric)}`) +
    `. ${worstLabel(metric)}: ${fmt(worst, metric)}` +
    (missing > 0 ? `. Дней без данных: ${missing}` : "");

  return (
    <DcCard as="section">
      {head}

      <div className="flex flex-wrap items-end justify-between gap-x-7 gap-y-4 border-line border-t px-5 pt-4 pb-3.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="t-label">
            {metric === "hf" ? "Health factor" : "LTV"}
          </span>
          {/* Цвет числа — общая шкала зон (hfTone), та же, что у HF в шапке
              экрана и в бейдже. У LTV своей шкалы зон нет: цвет риска несёт
              HF, и красить два числа двумя разными правилами нельзя */}
          <p
            className={cn(
              "t-display-sm",
              metric === "hf" && toneClass(hfTone(last.value, threshold)),
            )}
          >
            {fmt(last.value, metric)}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
          <Summary label={`За ${periodLabel}`}>
            {change === null ? (
              <span className="text-text-3">—</span>
            ) : (
              <span className="text-text-2">
                {fmtSigned(change.abs, metric)}
              </span>
            )}
          </Summary>
          <Summary label={worstLabel(metric)}>
            <span className="text-text-2">{fmt(worst, metric)}</span>
          </Summary>
        </div>
      </div>

      <div className="border-line border-t bg-sunken px-3 pt-2 pb-2">
        <div className="relative h-[186px] sm:h-[226px]">
          {/* Заливки нет: её основание лежало бы на низу домена, а не
              на границе решения, и площадь читалась бы как величина,
              которой нет */}
          <SeriesChart
            rows={rows}
            axis={axis}
            color="var(--accent)"
            fillOpacity={0}
            ariaLabel={ariaLabel}
            formatY={(value) => fmtAxis(value, metric)}
            refLines={refLines}
            renderTooltip={(row) => (
              <TooltipCard
                title={tableDate(row.takenOn)}
                note={row.isPartial ? "частичные данные" : undefined}
              >
                {fmt(row.value!, metric)}
              </TooltipCard>
            )}
          />
        </div>
      </div>

      <ChartNote
        missing={missing}
        anyPartial={anyPartial}
        missingLabel={`дни без снепшота или без ${metric === "hf" ? "HF" : "LTV"}`}
        extra={
          excluded > 0 ? (
            <span>
              точек без данных: <span className="font-mono">{excluded}</span>
              {metric === "hf"
                ? " — долга не было либо здоровье не читалось"
                : " — залог или долг не читались"}
            </span>
          ) : null
        }
        className="border-line border-t px-card py-3"
      />
    </DcCard>
  );
}

/**
 * Почему графика нет — словами и по конкретной причине. Пустая ось вместо
 * ответа заставляла бы гадать, сломалось что-то или данных правда нет.
 */
function Empty({
  loading,
  error,
  metric,
  periodLabel,
  snapshots,
  points,
}: {
  loading: boolean;
  error: string | null;
  metric: RiskMetric;
  periodLabel: string;
  snapshots: number;
  points: number;
}) {
  if (error !== null) return <>Не удалось загрузить историю: {error}</>;
  if (loading) return <>Загружаем историю…</>;
  if (snapshots === 0) return <>За {periodLabel} снепшотов нет.</>;
  if (points === 0) {
    return (
      <>
        {metric === "hf"
          ? "За этот период health factor не сохранён ни в одной точке: раньше он в снепшот не писался, а задним числом его взять неоткуда."
          : "За этот период LTV не считается: залог в снепшот раньше не писался, а без него отношение долга к залогу не восстановить."}{" "}
        График начнётся со следующего снепшота.
      </>
    );
  }
  return <>Одна точка — кривой нужна вторая. Следующий снепшот достроит график.</>;
}

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

/** Подпись деления оси Y: «1,74» у HF, «31%» у LTV — без лишних знаков. */
function fmtAxis(value: number, metric: RiskMetric): string {
  return metric === "hf" ? tableNumber(value, 2) : tablePct(value, 0);
}

/** «1,74» у HF, «31,2%» у LTV. */
function fmt(value: number, metric: RiskMetric): string {
  return metric === "hf" ? tableNumber(value, 2) : tablePct(value, 1);
}

/** Изменение — в единицах метрики: у HF это пункты, у LTV — п.п. */
function fmtSigned(value: number, metric: RiskMetric): string {
  return metric === "hf"
    ? tableSigned(value, 2)
    : `${tableSigned(value, 1)}%`;
}

function worstLabel(metric: RiskMetric): string {
  return metric === "hf" ? "Минимум за период" : "Максимум за период";
}

/** Та же раскраска, что у HF в шапке экрана «Долг» (debt-hero). */
function toneClass(tone: ReturnType<typeof hfTone>): string {
  return cn(
    tone === "profit" && "text-profit",
    tone === "warn" && "text-warn",
    tone === "loss" && "text-loss",
    tone === null && "text-text-3",
  );
}
