"use client";

import type { ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { TooltipCard } from "./tooltip-card";

/**
 * Подсказка значения на полосе данных — тот же жест и та же карточка, что
 * у графиков: навёл на сегмент, увидел число.
 *
 * Раньше здесь стоял нативный `title`: подсказка ОС появлялась через
 * секунду, выглядела чужой и на тач-экране не открывалась вовсе. Radix
 * открывает её и по focus, поэтому триггер обязан быть настоящей кнопкой,
 * а не div — иначе с клавиатуры значение недостижимо.
 *
 * Провайдер тултипов у экранов свой (portfolio-screen, history-screen,
 * zones/card-parts): в layout приложения его нет.
 */
export function DataTip({
  title,
  value,
  note,
  side = "top",
  children,
}: {
  /** Что это: название актива, зоны, категории. */
  title: string;
  /** Само число — читается первым. */
  value: ReactNode;
  note?: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** Триггер: обязан принимать ref и быть фокусируемым. */
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          collisionPadding={12}
          className="pointer-events-none z-50 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <TooltipCard title={title} note={note}>
            {value}
          </TooltipCard>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
