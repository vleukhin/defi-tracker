"use client";

import { zoneColor } from "@/components/dc/chip";
import { HelpTip } from "@/components/dc/help-tip";
import { AccentCard } from "@/components/portfolio/accent-card";
import { countLabel } from "@/components/portfolio/plural";
import type { ZoneBreakdownDto } from "@/lib/api/types";
import { dcUsd, tablePct } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Карточка зоны стратегии: сколько капитала решает эту задачу.
 *
 * Задача зоны — не абзац в интерфейсе, а одно предложение под «?» (§1.3):
 * читают карточку ради суммы, а формулировку стратегии перечитывают редко.
 * Цвет зоны здесь кромка и точка — тот же цвет стоит у зоны на карточке
 * позиции, и разрез читается без легенды.
 */
export function ZoneCard({ zone }: { zone: ZoneBreakdownDto }) {
  return (
    <AccentCard color={zoneColor(zone.zone)}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-[7px] shrink-0 rounded-full"
          style={{ background: zoneColor(zone.zone) }}
        />
        <h3 className="text-[14px] font-semibold tracking-[-0.01em]">
          {zone.label}
        </h3>
        <HelpTip>{zone.purpose}</HelpTip>
        <span className="ml-auto text-[13px] font-medium text-text-2">
          {zone.percent === null ? "—" : tablePct(zone.percent, 1)}
        </span>
      </div>

      <p
        className={cn(
          "mt-3.5 t-metric-lg",
          zone.valueUsd === null && "text-text-3",
        )}
        title={
          zone.valueUsd === null
            ? "Стоимость части позиций зоны неизвестна — сумма не выводится"
            : undefined
        }
      >
        {zone.valueUsd === null ? "—" : dcUsd(zone.valueUsd)}
      </p>

      <p className="mt-1.5 text-[12.5px] text-text-3">{composition(zone)}</p>
    </AccentCard>
  );
}

/**
 * Из чего сложилась зона — строкой, а не таблицей: слагаемых максимум три,
 * и вопрос к карточке «сколько», а не «как именно».
 */
function composition(zone: ZoneBreakdownDto): string {
  const parts: string[] = [];
  if (zone.positionCount > 0) {
    parts.push(countLabel(zone.positionCount, "позиция", "позиции", "позиций"));
  }
  if (zone.collateralUsd > 0) parts.push("залог");
  if (zone.manualUsd > 0) parts.push("записи вручную");
  if (zone.freeUsd > 0) parts.push("свободные");
  return parts.length === 0 ? "пока пусто" : parts.join(" · ");
}
