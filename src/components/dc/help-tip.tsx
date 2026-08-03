"use client";

import type { ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * «?» — единственное место, где живут объяснения (дизайн-код §1.3).
 * Методики расчёта не лежат абзацем в интерфейсе: в потоке остаётся
 * максимум одна строка-вывод, формула словами прячется сюда.
 *
 * Триггер — круг 14px (15px в заголовках секций) с обводкой --line-strong
 * и cursor:help. На тач-ширинах срабатывает по тапу: Radix открывает
 * тултип по focus, поэтому триггер — настоящая кнопка, а не span.
 */
export function HelpTip({
  children,
  size = "sm",
  className,
  side = "top",
  label = "Пояснение",
}: {
  /** Одно-два предложения. Формула словами, а не разметка. */
  children: ReactNode;
  size?: "sm" | "md";
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  label?: string;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "relative inline-grid shrink-0 cursor-help place-items-center rounded-full border border-line-strong font-semibold text-text-3 leading-none outline-none transition-colors duration-120 ease-out hover:border-line-hover hover:text-text-2 focus-visible:ring-3 focus-visible:ring-ring/50",
            // Круг остаётся 14px, а палец попадает в 44px: hit-зона
            // растягивается псевдоэлементом, чтобы не раздувать вёрстку строки
            "before:-translate-x-1/2 before:-translate-y-1/2 before:absolute before:top-1/2 before:left-1/2 before:size-[14px] before:content-[''] pointer-coarse:before:size-11",
            size === "sm" ? "size-[14px] text-[9.5px]" : "size-[15px] text-[10px]",
            className,
          )}
        >
          ?
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={9}
          collisionPadding={12}
          className="pointer-events-none z-50 max-w-[300px] rounded-[9px] border border-line-strong bg-raised px-[11px] py-[9px] text-[12.5px]/[1.45] text-text-1 shadow-(--shadow-pop) data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          {children}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
