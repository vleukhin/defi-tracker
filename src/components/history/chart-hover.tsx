"use client";

import { useRef, useState } from "react";

/**
 * Слой наведения для графиков истории: невидимые зоны-кнопки поверх
 * графика. Тултип доступен и с клавиатуры — по стрелкам (roving tabindex:
 * в порядок обхода попадает одна зона, между точками ходят Arrow/Home/End,
 * иначе 365 точек за год превратили бы Tab в бесконечность).
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
