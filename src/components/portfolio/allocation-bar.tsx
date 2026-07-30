"use client";

import Link from "next/link";
import type { PortfolioRowDto } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { tablePct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CATEGORY_BG, CategoryDot } from "./category";

/**
 * Полоса аллокации — сигнатурный элемент (ТЗ §5.1.4): одна стековая полоса
 * трех категорийных цветов с рисками-целями на кумулятивных границах.
 * Стыки сегментов совпадают с рисками → портфель в балансе; расхождение
 * видно как сдвиг стыка от риски.
 */
export function AllocationBar({
  rows,
  totalUsd,
}: {
  rows: PortfolioRowDto[];
  totalUsd: number;
}) {
  const empty = totalUsd === 0;
  const hasTargets = rows.some((r) => r.targetPercent !== null);

  // Риски на кумулятивных границах целей: x = цель_BTC, x = цель_BTC + цель_ETH
  const markers: { label: string; targetPct: number; x: number }[] = [];
  let cumulative = 0;
  for (const row of rows.slice(0, -1)) {
    if (row.targetPercent === null) break;
    cumulative += row.targetPercent;
    markers.push({ label: row.label, targetPct: row.targetPercent, x: cumulative });
  }

  const ariaLabel = empty
    ? "Аллокация: портфель пуст"
    : `Аллокация: ${rows
        .map(
          (r) =>
            `${r.label} ${tablePct(r.percent)}` +
            (r.targetPercent !== null
              ? ` при цели ${tablePct(r.targetPercent)}`
              : ""),
        )
        .join(", ")}`;

  return (
    <Card className="p-4">
      <div role="img" aria-label={ariaLabel} className="relative h-3">
        {empty ? (
          <div className="h-full w-full rounded-full bg-muted" />
        ) : (
          <div className="flex h-full gap-0.5">
            {rows
              .filter((row) => row.percent > 0)
              .map((row) => (
                <div
                  key={row.category}
                  className={cn(
                    "h-full transition-[width] duration-400 ease-out first:rounded-l-full last:rounded-r-full",
                    CATEGORY_BG[row.category],
                  )}
                  style={{
                    width: `${row.percent}%`,
                    minWidth: row.percent < 1 ? "4px" : undefined,
                  }}
                />
              ))}
          </div>
        )}

        {!empty && markers.length > 0 && (
          <TooltipProvider>
            {markers.map((m) => (
              <Tooltip key={m.label}>
                <TooltipTrigger asChild>
                  <span
                    className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
                    style={{ left: `${m.x}%` }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  Цель {m.label}:{" "}
                  <span className="font-mono">{tablePct(m.targetPct)}</span>
                </TooltipContent>
              </Tooltip>
            ))}
          </TooltipProvider>
        )}
      </div>

      {/* Легенда: на мобильных — только точки и проценты (ТЗ §5.1.7) */}
      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {empty ? (
          <span className="text-xs text-muted-foreground">Портфель пуст</span>
        ) : (
          rows.map((row) => (
            <span key={row.category} className="inline-flex items-center gap-1.5">
              <CategoryDot category={row.category} />
              <span className="text-xs">{row.label}</span>
              <span className="font-mono text-xs">{tablePct(row.percent)}</span>
              {row.targetPercent !== null && (
                <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                  → {tablePct(row.targetPercent)}
                </span>
              )}
            </span>
          ))
        )}
        {!empty && !hasTargets && (
          <Link
            href="/targets"
            className="ml-auto text-xs text-link underline-offset-4 hover:underline"
          >
            Задать цели →
          </Link>
        )}
      </div>
    </Card>
  );
}
