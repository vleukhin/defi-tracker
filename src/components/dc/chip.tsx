import type { ReactNode } from "react";
import type { StrategyZone } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Чипы дизайн-кода (§5). Три вида, и смешивать их нельзя:
 *  - зона: заливка 10% цвета зоны + текст --zone-*-text;
 *  - статус: заливка 8% + обводка 18% + цвет семантики (только риск и P/L);
 *  - нейтральный: --bg-chip + --text-2 — всё остальное.
 *
 * Зелёный и красный не выдаются зонам и активам: цвет зоны, спутанный
 * с цветом прибыли, — главная ошибка старого интерфейса.
 */

const BASE =
  "inline-flex h-[21px] w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip px-[7px] font-medium text-[11.5px] leading-none";

export const ZONE_LABEL: Record<StrategyZone, string> = {
  growth: "Growth",
  yield: "Yield",
  stability: "Stability",
};

/** CSS-переменная цвета зоны — заливка, точка, кромка. Не текст. */
export function zoneColor(zone: StrategyZone): string {
  return `var(--zone-${zone})`;
}

/** CSS-переменная текстового оттенка зоны — только текст. */
export function zoneTextColor(zone: StrategyZone): string {
  return `var(--zone-${zone}-text)`;
}

export function ZoneChip({
  zone,
  className,
}: {
  zone: StrategyZone;
  className?: string;
}) {
  return (
    <span
      className={cn(BASE, className)}
      style={{
        background: `color-mix(in srgb, ${zoneColor(zone)} 10%, transparent)`,
        color: zoneTextColor(zone),
      }}
    >
      {ZONE_LABEL[zone]}
    </span>
  );
}

export type StatusTone = "profit" | "warn" | "loss";

/** Статус риска: «в диапазоне», «на границе», «ликвидация». */
export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  const color = `var(--${tone})`;
  return (
    <span
      className={cn(BASE, className)}
      style={{
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 18%, transparent)`,
        color,
      }}
    >
      {children}
    </span>
  );
}

/** Всё, что не зона и не риск: тип позиции, сторона сделки, связь. */
export function Chip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(BASE, "bg-chip text-text-2", className)}>
      {children}
    </span>
  );
}
