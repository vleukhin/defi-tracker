"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Label,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ActiveDotProps,
  DotItemDotProps,
  TooltipContentProps,
} from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { tableNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  type DatedPoint,
  type ValueAxis,
  dateFromDay,
  dayNumber,
  denseDays,
  niceTicks,
  signGradientOffset,
} from "./chart-geometry";

/**
 * Общий слой графиков на Recharts. Один модуль на всё приложение: линия
 * стоимости, прибыль, количества, риск — это один и тот же график с разной
 * подписью оси Y, и расходиться в мелочах они не должны.
 *
 * Дни без снепшота приходят сюда значением null и рвут линию
 * (connectNulls={false}) — интерполяции пропусков нет и не будет.
 * Частичная точка отличается ФОРМОЙ (полая), а не только цветом.
 */

/**
 * Монотонная интерполяция, а не «красивая» кардинальная: monotone
 * не даёт выбросов за пределы фактических значений между точками.
 * Кривая, рисующая максимум, которого в данных нет, — та же ложь,
 * что и прямая через две недели без снепшотов.
 */
const CURVE = "monotone" as const;

/** Появление ряда. isAnimationActive по умолчанию 'auto' — Recharts сам
 *  гасит анимацию при prefers-reduced-motion и в SSR. */
const ANIMATION_MS = 260;

/**
 * Ширина оси Y ОДНА на все графики «Истории» и фиксированная, а не
 * подобранная под содержимое: на экране они стоят друг под другом, и поле
 * графика обязано начинаться на одной вертикали, иначе одна и та же дата
 * окажется в разных местах у соседних карточек. Отсюда же компактные
 * подписи («158,9k», а не «$158 892») — ось не должна съедать поле.
 */
export const Y_AXIS_WIDTH = 52;

/**
 * Отступ справа: под кольцо активной точки, иначе её половина срезается
 * краем поля. Общий для всех графиков — от него зависит правая граница.
 */
export const CHART_RIGHT = 6;

/** Поля поля графика. Общие для всех — от них зависит совпадение вертикалей. */
const MARGIN = { top: 8, right: CHART_RIGHT, bottom: 0, left: 0 } as const;

/** Подпись оси — роль .t-axis из дизайн-кода: Mono 11,5px --text-3. */
export const AXIS_TICK = {
  fill: "var(--text-3)",
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
} as const;

const CHART_CONFIG = { value: { label: "Значение" } } satisfies ChartConfig;

/* ------------------------------------------------------------------ ряд */

/** День календаря в виде, который понимает Recharts. */
export interface SeriesRow<T> {
  takenOn: string;
  /**
   * Номер календарного дня UTC. Ось X числовая, а не категориальная:
   * равные промежутки между днями держит сама шкала, а не порядок строк.
   */
  day: number;
  /** null — снепшота в этот день не было: здесь линия рвётся. */
  value: number | null;
  isPartial: boolean;
  /** Точка без соседей: линии из неё не выйдет, её рисует маркер. */
  isolated: boolean;
  /** Исходная точка серии — из неё тултип берёт всё остальное. */
  point: T | null;
}

/**
 * Календарь без дыр в индексах, но с дырами в значениях. Собирается
 * одинаково всеми графиками: домен, разрывы и маркеры обязаны совпадать,
 * иначе один ряд получит на двух экранах разную форму.
 */
export function seriesRows<T extends DatedPoint>(
  points: readonly T[],
  value: (point: T) => number,
  isPartial: (point: T) => boolean = () => false,
): SeriesRow<T>[] {
  const days = denseDays(points);
  return days.map((day, i) => ({
    takenOn: day.takenOn,
    day: dayNumber(day.takenOn),
    value: day.point === null ? null : value(day.point),
    isPartial: day.point !== null && isPartial(day.point),
    isolated:
      day.point !== null &&
      days[i - 1]?.point == null &&
      days[i + 1]?.point == null,
    point: day.point,
  }));
}

/**
 * Домен и деления оси Y. Границы округляются: у графика теперь есть сетка,
 * а сетка с подписями «$153 287,41» не читается. Величины, которые обязаны
 * попасть в поле зрения (порог HF, целевой LTV, ноль на Прибыли),
 * передаются в `include`: график риска, на котором не видно границы
 * решения, отвечает «как менялось», но не «насколько близко».
 */
export function seriesAxis(
  values: readonly number[],
  include: readonly number[] = [],
): ValueAxis {
  const finite = [...values, ...include].filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { min: 0, max: 1, ticks: [0, 1] };
  return niceTicks(Math.min(...finite), Math.max(...finite), 5);
}

/* --------------------------------------------------------------- график */

/**
 * Опорная линия — не сетка: сетка отвечает «сколько», опорная линия несёт
 * значение, осмысленное независимо от данных (безубыток, порог, цель).
 * Поэтому она заметно ярче сетки — --text-3 против --line-strong — и всегда
 * подписана. Цвет линейный: зелёного и красного в графике не бывает.
 */
export interface RefLine {
  value: number;
  label: string;
  /**
   * Уровни ликвидации отличаются ФОРМОЙ — пунктиром, а не цветом: они
   * говорят не «куда стремимся», а «где всё кончится».
   */
  dashed?: boolean;
}

export function SeriesChart<T>({
  rows,
  axis,
  color,
  signColors = false,
  fillOpacity = 0.22,
  ariaLabel,
  formatY,
  refLines = [],
  renderTooltip,
  compact = false,
  className,
}: {
  rows: SeriesRow<T>[];
  axis: ValueAxis;
  color: string;
  /**
   * Знакопеременный ряд: выше нуля --profit, ниже --loss, заливка висит
   * от нулевой линии. Единственное исключение из «зелёного и красного
   * в графиках не бывает» (дизайн-код §5) — у Прибыли знак результата
   * и есть содержание ряда, а не украшение поверх него.
   */
  signColors?: boolean;
  /** Верхняя точка градиента заливки; 0 — заливки нет. */
  fillOpacity?: number;
  ariaLabel: string;
  /** Подпись деления оси Y — компактная, ось узкая на всех графиках. */
  formatY: (value: number) => string;
  refLines?: RefLine[];
  /** Тултип точки; не передан — график без наведения (превью). */
  renderTooltip?: (row: SeriesRow<T>) => React.ReactNode;
  /** Спарклайн в карточке: без сетки, без осей — на 88px им нет места. */
  compact?: boolean;
  className?: string;
}) {
  // useId даёт «:r3:» — двоеточия в url(#…) читаются не везде
  const uid = useId().replace(/:/g, "");
  const fillId = `series-fill-${uid}`;
  const strokeId = `series-stroke-${uid}`;
  const firstDay = rows.length > 0 ? rows[0].day : 0;
  const lastDay = rows.length > 0 ? rows[rows.length - 1].day : 1;
  const span = lastDay - firstDay + 1;
  const zeroOffset = signColors
    ? signGradientOffset(rows.map((r) => r.value))
    : 1;

  return (
    <ChartContainer
      config={CHART_CONFIG}
      /* Не role="img": под ним лежит фокусируемый svg с точками, а потомки
         img для скринридера презентационны — обход по стрелкам исчез бы
         из дерева доступности. figure держит и подпись, и содержимое. */
      role="figure"
      aria-label={ariaLabel}
      className={cn("aspect-auto h-full w-full", className)}
    >
      <AreaChart data={rows} margin={compact ? COMPACT_MARGIN : MARGIN}>
        <defs>
          {signColors ? (
            <>
              {/* Два стопа в одной точке — стык цвета без перехода: между
                  прибылью и убытком нет промежуточного состояния */}
              <linearGradient id={strokeId} x1="0" y1="0" x2="0" y2="1">
                <stop offset={zeroOffset} stopColor="var(--profit)" />
                <stop offset={zeroOffset} stopColor="var(--loss)" />
              </linearGradient>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset={0} stopColor="var(--profit)" stopOpacity={0.28} />
                <stop
                  offset={zeroOffset}
                  stopColor="var(--profit)"
                  stopOpacity={0.02}
                />
                <stop
                  offset={zeroOffset}
                  stopColor="var(--loss)"
                  stopOpacity={0.02}
                />
                <stop offset={1} stopColor="var(--loss)" stopOpacity={0.28} />
              </linearGradient>
            </>
          ) : (
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={fillOpacity} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          )}
        </defs>

        {/* Сетка ТОЛЬКО горизонтальная: она привязывает кривую к делениям
            оси Y. Вертикальных линий нет — дату называет подпись под точкой,
            и решётка из вертикалей соревновалась бы с самой кривой. */}
        {!compact && (
          <CartesianGrid
            vertical={false}
            stroke="var(--line-strong)"
            strokeWidth={1}
          />
        )}

        {/* Календарная ось. Домен раздвинут на полдня в обе стороны — тогда
            день d встаёт в ((d − first) + 0.5) / span, то есть в центр своей
            дневной полосы, как у столбцов «Пропорций категорий». */}
        <XAxis
          dataKey="day"
          type="number"
          domain={[firstDay - 0.5, lastDay + 0.5]}
          hide={compact}
          ticks={dayTicks(firstDay, lastDay)}
          tickFormatter={(day: number) => axisDate(day, span)}
          interval="preserveStartEnd"
          minTickGap={26}
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          height={30}
          tick={AXIS_TICK}
        />

        <YAxis
          domain={[axis.min, axis.max]}
          ticks={axis.ticks}
          hide={compact}
          width={Y_AXIS_WIDTH}
          tickFormatter={formatY}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={AXIS_TICK}
        />

        {refLines.map((line) => (
          <ReferenceLine
            key={line.label}
            y={line.value}
            stroke="var(--text-3)"
            strokeDasharray={line.dashed ? "4 3" : undefined}
          >
            <Label
              value={line.label}
              position="insideTopRight"
              fill="var(--text-3)"
              fontFamily="var(--font-mono)"
              fontSize={11.5}
            />
          </ReferenceLine>
        ))}

        {renderTooltip && (
          <ChartTooltip
            cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
            offset={14}
            wrapperStyle={{ outline: "none", zIndex: 10 }}
            isAnimationActive={false}
            content={(props: TooltipContentProps) => {
              const row = props.active
                ? (props.payload?.[0]?.payload as SeriesRow<T> | undefined)
                : undefined;
              if (!row || row.value == null) return null;
              return renderTooltip(row);
            }}
          />
        )}

        <Area
          dataKey="value"
          type={CURVE}
          connectNulls={false}
          stroke={signColors ? `url(#${strokeId})` : color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={`url(#${fillId})`}
          /* Основание заливки — ноль, а не низ домена: иначе площадь под
             отрицательной ветвью читалась бы как «размер убытка», хотя она
             всего лишь расстояние до края карточки */
          baseValue={signColors ? 0 : undefined}
          dot={(props: DotItemDotProps) => (
            <SeriesDot {...props} color={color} signColors={signColors} />
          )}
          activeDot={
            renderTooltip
              ? (props: ActiveDotProps) => (
                  <ActiveDot {...props} color={color} signColors={signColors} />
                )
              : false
          }
          animationDuration={ANIMATION_MS}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ChartContainer>
  );
}

const COMPACT_MARGIN = { top: 4, right: 0, bottom: 0, left: 0 } as const;

/**
 * Постоянных точек на графике нет — рисуются только те, о которых надо
 * знать: частичные (полая форма) и одиночные, у которых линии нет вовсе.
 */
function SeriesDot({
  cx,
  cy,
  payload,
  color,
  signColors,
}: DotItemDotProps & { color: string; signColors: boolean }) {
  const row = payload as SeriesRow<unknown>;
  if (cx == null || cy == null || row?.value == null) return null;
  if (!row.isPartial && !row.isolated) return null;

  return row.isPartial ? (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="var(--bg-sunken)"
      stroke="var(--warn)"
      strokeWidth={2}
    />
  ) : (
    <circle cx={cx} cy={cy} r={3.5} fill={pointColor(row, color, signColors)} />
  );
}

/** Точка под курсором: заливка --text-1 в кольце цвета своей точки. */
function ActiveDot({
  cx,
  cy,
  payload,
  color,
  signColors,
}: ActiveDotProps & { color: string; signColors: boolean }) {
  const row = payload as SeriesRow<unknown>;
  if (cx == null || cy == null) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4.5}
      fill="var(--text-1)"
      stroke={pointColor(row, color, signColors)}
      strokeWidth={2.5}
    />
  );
}

/** Цвет точки: в знаковом режиме — по её собственному знаку. */
function pointColor(
  row: SeriesRow<unknown> | undefined,
  color: string,
  signColors: boolean,
): string {
  if (!signColors) return color;
  return (row?.value ?? 0) < 0 ? "var(--loss)" : "var(--profit)";
}


/* -------------------------------------------------------- подписи осей */

/**
 * Деления оси X — календарные дни, а не точки ряда: подписи должны стоять
 * ровным шагом даже там, где снепшоты сгущаются. Список прореживает сам
 * Recharts по minTickGap, здесь только ограничивается его длина.
 */
export function dayTicks(firstDay: number, lastDay: number): number[] {
  const span = lastDay - firstDay + 1;
  const step = Math.max(1, Math.ceil(span / 120));
  const ticks: number[] = [];
  for (let day = firstDay; day <= lastDay; day += step) ticks.push(day);
  if (ticks[ticks.length - 1] !== lastDay) ticks.push(lastDay);
  return ticks;
}

/** «19.08» на коротком периоде, «08.2026» — когда период шире года. */
function axisDate(day: number, span: number): string {
  return axisDateIso(dateFromDay(day), span);
}

export function axisDateIso(iso: string, span: number): string {
  return span > 400
    ? `${iso.slice(5, 7)}.${iso.slice(0, 4)}`
    : `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

/** «158,9k», «−25,8k», «418» — подпись оси Y без валютного знака. */
export function compactValue(value: number): string {
  // Ноль — просто «0»: у знакопеременного ряда это деление оси, а «0,0000»
  // и шире всех остальных подписей, и читается как точность, которой нет
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1000) return `${tableNumber(value / 1000, abs >= 100_000 ? 0 : 1)}k`;
  if (abs >= 10) return tableNumber(value, 0);
  return tableNumber(value, abs >= 1 ? 2 : 4);
}
