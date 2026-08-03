"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Сегментированный переключатель (дизайн-код §5): «Категории / Зоны»,
 * период истории, сторона сделки. Контейнер — --bg-surface с обводкой
 * --line-card, активный сегмент — --bg-raised-hover и вес 500.
 *
 * Это переключатель ОДНОГО набора данных в другом разрезе, не навигация:
 * поэтому radiogroup, а не ссылки.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        // На тач-ширинах контрол дорастает до 44px: 34px — это hit-зона
        // мимо пальца, а дизайн-код требует не меньше 44 (§6)
        "inline-flex h-control items-center gap-0.5 rounded-control border border-line-card bg-surface p-[3px] pointer-coarse:h-11",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-full min-w-11 rounded-pill px-3 text-[13px] outline-none transition-colors duration-120 ease-out focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "bg-raised-hover font-medium text-text-1"
                : "text-text-2 hover:text-text-1",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Фильтр-чипы (Все / Growth / Yield / Stability, активы в сделках).
 * Отличаются от Segmented тем, что живут в потоке и не образуют
 * единого контрола: у каждого своя обводка.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              // 28px — плотность десктопа; на тач-ширинах чип дорастает до 44
              "h-[28px] rounded-control border px-2.5 text-[12.5px] outline-none transition-colors duration-120 ease-out pointer-coarse:h-11 pointer-coarse:px-4 focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "border-line-strong bg-raised text-text-1"
                : "border-line-card bg-transparent text-text-2 hover:border-line-strong hover:text-text-1",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
