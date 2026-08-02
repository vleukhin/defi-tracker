"use client";

import { Card } from "@/components/ui/card";
import type { ZoneBreakdownDto } from "@/lib/api/types";
import { tablePct, tableUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ZONE_ACCENT, zoneTint } from "./shared";

/**
 * Карточка зоны стратегии: из чего сложилась и сколько стоит.
 *
 * Цвет зоны здесь — точка, кромка и тинт; тот же цвет стоит точкой у зоны
 * на карточке позиции. Разрез читается без легенды: видно, какая позиция
 * в какой зоне лежит, не переводя взгляд на подписи.
 */
export function ZoneCard({ zone }: { zone: ZoneBreakdownDto }) {
  return (
    <Card
      className="p-4"
      style={{
        boxShadow: `inset 3px 0 0 ${ZONE_ACCENT[zone.zone]}`,
        background: zoneTint(zone.zone),
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: ZONE_ACCENT[zone.zone] }}
          />
          {zone.label}
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          {zone.percent === null ? "—" : tablePct(zone.percent, 1)}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{zone.purpose}</p>

      <p
        className={cn(
          "mt-2 font-mono text-2xl leading-none font-semibold tracking-tight",
          zone.valueUsd === null && "text-muted-foreground",
        )}
      >
        {zone.valueUsd === null ? "—" : tableUsd(zone.valueUsd)}
      </p>

      <dl className="mt-3 space-y-1 text-xs">
        <Row label="Залог" value={zone.collateralUsd} hideZero />
        <Row label="Свободные стейблы" value={zone.manualUsd} hideZero />
        <Row
          label={`Позиции (${zone.positionCount})`}
          value={zone.positionsUsd}
          hideZero={zone.positionCount === 0}
        />
      </dl>
    </Card>
  );
}

function Row({
  label,
  value,
  hideZero,
}: {
  label: string;
  value: number | null;
  hideZero?: boolean;
}) {
  if (hideZero && value === 0) return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value === null ? "—" : tableUsd(value)}</dd>
    </div>
  );
}
