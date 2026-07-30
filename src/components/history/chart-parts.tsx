"use client";

import { useRef, useState } from "react";
import { tableDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { pickTicksByX } from "./chart-geometry";

/**
 * Общая обвязка графиков истории: слой наведения, тултип, ось дат
 * и легенда разрывов. Одинакова у графика стоимости и графика пропорций —
 * обе оси времени должны выглядеть и вести себя одинаково.
 */

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
  // Точка в порядке обхода: последняя (самая свежая) — она интереснее всех
  const [roving, setRoving] = useState(zones.length - 1);

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
    <div className="absolute inset-0">
      {zones.map((zone, i) => (
        <button
          key={i}
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
          className="absolute top-0 bottom-0 cursor-default rounded-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      ))}
    </div>
  );
}

/**
 * Тултип точки: карточка уровня 2 (popover) над графиком. У краев
 * прижимается к своей стороне, чтобы не уезжать за пределы карточки.
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
      aria-hidden="true"
      style={{ left: `${x}%` }}
      className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 data-[side=left]:translate-x-0 data-[side=right]:-translate-x-full"
      data-side={side}
    >
      <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-lg">
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
    <div aria-hidden="true" className={cn("relative mt-1.5 h-4", className)}>
      {pickTicksByX(xs, count, minGap).map((i) => (
        <span
          key={points[i].takenOn}
          style={{ left: `${points[i].x}%` }}
          data-edge={tickEdge(points[i].x)}
          className="absolute -translate-x-1/2 font-mono text-[10px] whitespace-nowrap text-muted-foreground data-[edge=end]:-translate-x-full data-[edge=start]:translate-x-0"
        >
          {tableDate(points[i].takenOn)}
        </span>
      ))}
    </div>
  );
}

/** Легенда разрывов и частичных точек — цвет никогда не единственный сигнал. */
export function ChartLegend({
  missing,
  anyPartial,
}: {
  missing: number;
  anyPartial: boolean;
}) {
  if (missing === 0 && !anyPartial) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {anyPartial && (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 shrink-0 rounded-full border-2 border-warning bg-background"
          />
          частичные данные
        </span>
      )}
      {missing > 0 && (
        <span>
          разрывы — дни без снепшота:{" "}
          <span className="font-mono">{missing}</span>
        </span>
      )}
    </div>
  );
}
