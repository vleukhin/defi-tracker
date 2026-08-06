"use client";

import { useEffect, useId, useRef, useState } from "react";
import { tableDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  areaPath,
  linePath,
  pickTicksByX,
  type PlotPoint,
  type ValueAxis,
} from "./chart-geometry";

/**
 * Общая обвязка графиков истории: домен, отрисовка area+линии, слой
 * наведения, тултип, ось дат и примечание о разрывах. Одинакова у графика
 * стоимости, спарклайнов количеств и графика пропорций — все оси времени
 * на экране обязаны выглядеть и вести себя одинаково.
 *
 * Правила дизайн-кода §5 для графиков: линия 1px с non-scaling-stroke,
 * заливка градиентом цвета серии к нулю, СЕТКА НЕ РИСУЕТСЯ, подписи осей —
 * Mono 11,5px --text-3 (.t-axis). Зелёного и красного в графиках нет.
 */

/**
 * Домен оси Y без «круглых» делений: сетки на графиках нет, а значит
 * и приводить границы к круглым числам не за чем — важна форма кривой.
 * Ряд отбивается от краёв карточки на 8% размаха.
 *
 * Постоянный ряд (min === max) отдаёт нулевой домен: yPercent на нём
 * возвращает 50 — линия идёт по центру карточки, а не по нижнему краю
 * (README, «Графики»).
 */
const DOMAIN_PAD = 0.08;

export function valueDomain(
  values: readonly number[],
  /**
   * Величины, которые обязаны попасть в домен, даже если ряд до них
   * не доходит: порог HF и целевой LTV. График риска, на котором не видно
   * границы решения, отвечает на вопрос «как менялось», но не на вопрос
   * «насколько близко» — а спрашивают его. Ликвидационные уровни сюда
   * НЕ передаются: они далеко, и домен под них расплющил бы кривую.
   */
  include: readonly number[] = [],
): ValueAxis {
  const finite = [...values, ...include].filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { min: 0, max: 0, ticks: [] };
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  if (hi === lo) return { min: lo, max: lo, ticks: [] };
  const pad = (hi - lo) * DOMAIN_PAD;
  return { min: lo - pad, max: hi + pad, ticks: [] };
}

/** Отрезок подряд идущих дней: рисуется отдельным путём. */
export interface ChartRun {
  /** Стабильный ключ отрезка — дата его первой точки. */
  key: string;
  points: readonly PlotPoint[];
}

/**
 * Заливка + линия по отрезкам. Растягивается по контейнеру
 * (viewBox 0…100 + preserveAspectRatio="none") — толщину линии держит
 * vector-effect, поэтому она остаётся ровно 1px на любой ширине.
 */
export function ChartArea({
  runs,
  color,
  fillOpacity,
  ariaLabel,
  className,
}: {
  runs: ChartRun[];
  /** Цвет серии: --text-1 у портфеля, --asset-* у количеств. */
  color: string;
  /** Верхняя точка градиента: 0.16 у портфеля, 0.22 у количеств. */
  fillOpacity: number;
  ariaLabel: string;
  className?: string;
}) {
  // useId даёт «:r3:» — двоеточия в url(#…) читаются не везде
  const gradientId = `history-fill-${useId().replace(/:/g, "")}`;
  const drawable = runs.filter((run) => run.points.length >= 2);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn("block h-full w-full", className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={fillOpacity} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {drawable.map((run) => (
        <path
          key={`fill-${run.key}`}
          d={areaPath(run.points)}
          fill={`url(#${gradientId})`}
        />
      ))}
      {drawable.map((run) => (
        <path
          key={`line-${run.key}`}
          d={linePath(run.points)}
          fill="none"
          stroke={color}
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/**
 * Точка «частичные данные»: отличается ФОРМОЙ (полая), а не только цветом.
 * Единственный случай семантики в графике — это статус достоверности точки,
 * а не результат (дизайн-код §2).
 */
export function PartialMarker({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 rounded-full border-2 border-warn bg-sunken",
        className,
      )}
    />
  );
}

/**
 * Опорная линия графика: ноль у Прибыли, порог HF и целевой LTV у риска.
 *
 * Это НЕ сетка, запрещённая дизайн-кодом §5: сетка — повторяющиеся
 * декоративные линии, а здесь каждая линия несёт значение, осмысленное
 * независимо от данных (безубыток, порог предупреждения, цель, ликвидация).
 * Цвет линейный, не зелёный/красный: цвет результата в графике не живёт.
 * Уровни ликвидации отличаются ФОРМОЙ (пунктир), а не цветом — они говорят
 * о другом: не «куда стремимся», а «где всё кончится».
 */
export function ChartRefLine({
  y,
  label,
  dashed,
}: {
  /** Позиция в процентах сверху. */
  y: number;
  label: string;
  dashed?: boolean;
}) {
  return (
    <div
      aria-hidden
      style={{ top: `${y}%` }}
      className={cn(
        "absolute inset-x-0 border-line-strong border-t",
        dashed && "border-dashed",
      )}
    >
      <span className="t-axis absolute top-0.5 left-0 bg-sunken pr-1">
        {label}
      </span>
    </div>
  );
}

/**
 * Слой наведения: невидимые зоны-кнопки поверх графика. Тултип доступен
 * и с клавиатуры — по стрелкам (roving tabindex: в порядок обхода попадает
 * одна зона, между точками ходят Arrow/Home/End, иначе 365 точек за год
 * превратили бы Tab в бесконечность).
 */
export interface HoverZone {
  /** Левый край зоны в процентах ширины графика. */
  left: number;
  width: number;
  /** Что прочитает скринридер при фокусе на точке. */
  label: string;
}

export function HoverLayer({
  zones,
  onActive,
}: {
  zones: HoverZone[];
  onActive: (index: number | null) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const layerRef = useRef<HTMLDivElement>(null);
  // Точка в порядке обхода: последняя (самая свежая) — она интереснее всех
  const [roving, setRoving] = useState(zones.length - 1);

  /*
   * Тап мимо графика закрывает тултип.
   *
   * На тач-экране точка открывается по focus, а blur при касании в стороне
   * приходит не всегда: тултип оставался висеть над графиком до следующего
   * тапа по самому графику. Мышь сюда не попадает — там работает
   * onMouseLeave, и перехватывать её незачем.
   */
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (event.pointerType === "mouse") return;
      if (layerRef.current?.contains(event.target as Node)) return;
      onActive(null);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [onActive]);

  function move(next: number) {
    const clamped = Math.max(0, Math.min(zones.length - 1, next));
    setRoving(clamped);
    refs.current[clamped]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    switch (event.key) {
      case "ArrowRight":
        move(index + 1);
        break;
      case "ArrowLeft":
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(zones.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div ref={layerRef} className="absolute inset-0">
      {zones.map((zone, i) => (
        <button
          key={zone.label}
          type="button"
          ref={(el) => {
            refs.current[i] = el;
          }}
          tabIndex={i === Math.min(roving, zones.length - 1) ? 0 : -1}
          aria-label={zone.label}
          onMouseEnter={() => onActive(i)}
          onMouseLeave={() => onActive(null)}
          onFocus={() => onActive(i)}
          onBlur={() => onActive(null)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          style={{ left: `${zone.left}%`, width: `${zone.width}%` }}
          className="absolute top-0 bottom-0 cursor-default rounded-pill outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      ))}
    </div>
  );
}

/**
 * Тултип точки — всплывающий слой (дизайн-код §5): --bg-raised, обводка
 * --line-strong, радиус 9, 12,5px, тень --shadow-pop. У краёв прижимается
 * к своей стороне, чтобы не уезжать за пределы карточки.
 */
export function ChartTooltip({
  x,
  children,
}: {
  /** Позиция точки в процентах ширины графика. */
  x: number;
  children: React.ReactNode;
}) {
  const side = x < 25 ? "left" : x > 75 ? "right" : "center";
  return (
    <div
      aria-hidden
      style={{ left: `${x}%` }}
      className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 data-[side=left]:translate-x-0 data-[side=right]:-translate-x-full"
      data-side={side}
    >
      <div className="rounded-[9px] border border-line-strong bg-raised px-[11px] py-[9px] text-[12.5px]/[1.45] whitespace-nowrap text-text-1 shadow-(--shadow-pop)">
        {children}
      </div>
    </div>
  );
}

/**
 * Крайние подписи прижимаются к своей стороне, а не центрируются:
 * иначе «30.07.2026» вылезает за край карточки на узком экране.
 */
function tickEdge(x: number): "start" | "end" | "center" {
  if (x < 8) return "start";
  if (x > 92) return "end";
  return "center";
}

export interface AxisPoint {
  takenOn: string;
  /** Позиция в процентах ширины графика. */
  x: number;
}

/**
 * Ось дат в двух вариантах сразу: на узком экране подписей меньше и зазор
 * больше. Один компонент на все графики — оси времени обязаны стоять
 * на одной вертикали и разрежаться одинаково.
 *
 * Зазоры подобраны под ширину подписи «01.07.2026» (Mono 11,5px ≈ 68px):
 * на 375px это ~24% ширины поля графика, а крайняя подпись ещё и прижата
 * к своему краю — то есть заезжает внутрь на пол-ширины. Отсюда 36%
 * на узком экране: с 26% последние две даты налезали друг на друга.
 */
export function ChartTimeAxis({
  points,
  className,
}: {
  points: AxisPoint[];
  className?: string;
}) {
  return (
    <div className={className}>
      <ChartXAxis points={points} count={3} minGap={36} className="sm:hidden" />
      <ChartXAxis
        points={points}
        count={5}
        minGap={14}
        className="hidden sm:block"
      />
    </div>
  );
}

/**
 * Ось дат. Подписи разрежены по фактическим позициям точек и разведены
 * минимальным зазором — на календарной оси точки сгущаются неравномерно,
 * и равномерный шаг по индексу склеил бы соседние даты.
 */
export function ChartXAxis({
  points,
  count,
  minGap,
  className,
}: {
  points: AxisPoint[];
  count: number;
  /** Минимальный зазор между подписями, % ширины. */
  minGap: number;
  className?: string;
}) {
  const xs = points.map((p) => p.x);
  return (
    <div aria-hidden className={cn("relative h-[14px]", className)}>
      {pickTicksByX(xs, count, minGap).map((i) => (
        <span
          key={points[i].takenOn}
          style={{ left: `${points[i].x}%` }}
          data-edge={tickEdge(points[i].x)}
          className="t-axis absolute -translate-x-1/2 whitespace-nowrap data-[edge=end]:-translate-x-full data-[edge=start]:translate-x-0"
        >
          {tableDate(points[i].takenOn)}
        </span>
      ))}
    </div>
  );
}

/**
 * Примечание под графиком: разрывы и частичные точки. Цвет никогда
 * не единственный сигнал — у полой точки другая форма, у разрыва
 * подписано число дней.
 */
export function ChartNote({
  missing,
  anyPartial,
  /**
   * Чем именно вызваны разрывы. На графике стоимости это дни без снепшота;
   * на графике количества к ним добавляются дни, в которые снепшот есть,
   * но цены категории не было и количество не выведено.
   */
  missingLabel = "дни без снепшота",
  /** Своя оговорка карточки — например, сколько точек осталось без Прибыли. */
  extra,
  className,
}: {
  missing: number;
  anyPartial: boolean;
  missingLabel?: string;
  extra?: React.ReactNode;
  className?: string;
}) {
  if (missing === 0 && !anyPartial && !extra) return null;
  return (
    <div
      className={cn(
        "t-meta flex flex-wrap items-center gap-x-4 gap-y-1 text-text-3",
        className,
      )}
    >
      {anyPartial && (
        <span className="inline-flex items-center gap-1.5">
          <PartialMarker />
          частичные данные
        </span>
      )}
      {missing > 0 && (
        <span>
          разрывы — {missingLabel}: <span className="font-mono">{missing}</span>
        </span>
      )}
      {extra}
    </div>
  );
}
