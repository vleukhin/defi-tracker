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

      <Breakdown zone={zone} />
    </Card>
  );
}

/**
 * Из чего сложилась зона. Разбивка нужна, когда слагаемых несколько:
 * единственное слагаемое просто повторяет итог другим шрифтом, и вместо
 * ответа на вопрос «из чего» карточка показывает то же число дважды.
 *
 * Когда разбивка свернута, число позиций все равно говорится — оно про
 * состав зоны, а не про деньги, и из итога его не видно.
 */
function Breakdown({ zone }: { zone: ZoneBreakdownDto }) {
  const parts = [
    { label: "Залог", value: zone.collateralUsd },
    { label: "Свободные стейблы", value: zone.manualUsd },
    { label: `Позиции (${zone.positionCount})`, value: zone.positionsUsd },
  ].filter(
    (p) => p.value !== 0 && !(p.value === null && zone.positionCount === 0),
  );

  // Округление до доллара: суммы сходятся с итогом с точностью до центов
  const single =
    parts.length <= 1 &&
    (parts.length === 0 ||
      (parts[0].value !== null &&
        zone.valueUsd !== null &&
        Math.abs(parts[0].value - zone.valueUsd) < 0.5));

  if (single) {
    if (zone.positionCount === 0) return null;
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Позиций: <span className="font-mono">{zone.positionCount}</span>
      </p>
    );
  }

  return (
    <dl className="mt-3 space-y-1 text-xs">
      {parts.map((p) => (
        <div
          key={p.label}
          className="flex items-baseline justify-between gap-2"
        >
          <dt className="text-muted-foreground">{p.label}</dt>
          <dd className="font-mono">
            {p.value === null ? "—" : tableUsd(p.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
