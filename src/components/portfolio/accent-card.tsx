import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Карточка с цветной кромкой сверху — единственная допустимая цветная
 * обводка (§2: заливать карточку цветом данных нельзя, цветная обводка
 * шире 2px запрещена, верхний бордер 2px как метка — разрешён).
 *
 * Кромка задана инлайновым цветом намеренно: hover меняет обводку на
 * --line-strong, и цвет метки обязан пережить это правило, иначе карточка
 * теряет принадлежность к зоне или активу ровно в момент наведения.
 *
 * Радиус 12, а не 14: это карточка второго уровня в сетке из трёх,
 * hero над ней держит 14.
 */
export function AccentCard({
  color,
  children,
  className,
}: {
  /** CSS-переменная цвета зоны или актива. */
  color: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-block border border-line-card border-t-2 bg-surface px-card pt-4 pb-[18px] transition-colors duration-120 ease-out hover:border-line-strong",
        className,
      )}
      style={{ borderTopColor: color }}
    >
      {children}
    </div>
  );
}
