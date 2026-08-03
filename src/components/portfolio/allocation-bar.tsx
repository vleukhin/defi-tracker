"use client";

import type { ReactNode } from "react";
import { zoneColor, zoneTextColor } from "@/components/dc/chip";
import type {
  PortfolioRowDto,
  ZoneBreakdownDto,
  ZonesSummaryDto,
} from "@/lib/api/types";
import { dcUsd, tablePct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CATEGORY_VAR, assetTextColor } from "./category";
import { countLabel } from "./plural";

/**
 * Нижняя зона hero-карточки: как распределён капитал.
 *
 * Полоса 34px — единственный «крупный» визуал экрана, и она отвечает
 * на вопрос страницы целиком: доли читаются прямо внутри сегментов, без
 * перевода взгляда на легенду. Цвета берутся только из роли «данные»
 * (зоны и активы), семантике полоса не отдаётся: она показывает состав,
 * а не результат.
 */

interface AllocationSegment {
  key: string;
  percent: number;
  color: string;
  textColor: string;
  label: string;
  title: string;
}

/** Метка цели на кумулятивной границе: 2×42px поверх полосы. */
interface TargetMarker {
  key: string;
  x: number;
  title: string;
}

function AllocationFrame({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-line border-t bg-sunken px-5 pt-[18px] pb-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-[13px] font-medium text-text-2">{title}</span>
        {meta != null && <span className="text-[12px] text-text-3">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function AllocationSegments({
  segments,
  markers,
  ariaLabel,
}: {
  segments: AllocationSegment[];
  markers?: TargetMarker[];
  ariaLabel: string;
}) {
  if (segments.length === 0) {
    return (
      <div className="flex h-[34px] items-center rounded-pill bg-chip px-[11px] text-[12.5px] text-text-3">
        Распределение пока не считается
      </div>
    );
  }

  return (
    <div className="relative h-[34px]">
      <div role="img" aria-label={ariaLabel} className="flex h-[34px] gap-[3px]">
        {segments.map((s) => (
          <div
            key={s.key}
            title={s.title}
            className="flex items-center overflow-hidden rounded-pill px-[11px]"
            style={{
              width: `${s.percent}%`,
              // Доля меньше процента иначе схлопывается в невидимую полоску
              minWidth: s.percent > 0 ? 10 : 0,
              background: `linear-gradient(180deg, color-mix(in srgb, ${s.color} 20%, transparent), color-mix(in srgb, ${s.color} 8%, transparent))`,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${s.color} 28%, transparent)`,
            }}
          >
            {/* Узкий сегмент на 375px обрезал бы процент до «1…» —
                на таких ширинах подпись уходит, а доля остаётся в легенде
                и в подсказке сегмента */}
            <span
              className={cn(
                "truncate text-[12.5px] font-medium",
                s.percent < 25 && "hidden sm:inline",
              )}
              style={{ color: s.textColor }}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>
      {markers?.map((m) => (
        <span
          key={m.key}
          aria-hidden
          title={m.title}
          className="absolute top-[-4px] h-[42px] w-[2px] rounded-[2px] bg-text-1 opacity-75"
          style={{ left: `${m.x}%` }}
        />
      ))}
    </div>
  );
}

/** Разрез по зонам стратегии: Growth / Yield / Stability. */
export function ZoneAllocation({ zones }: { zones: ZonesSummaryDto }) {
  const withShare = zones.zones.filter(
    (z): z is ZoneBreakdownDto & { percent: number } =>
      z.percent !== null && z.percent > 0,
  );

  const segments: AllocationSegment[] = withShare.map((z) => ({
    key: z.zone,
    percent: z.percent,
    color: zoneColor(z.zone),
    textColor: zoneTextColor(z.zone),
    label: tablePct(z.percent, 1),
    title: `${z.label} — ${z.valueUsd === null ? "—" : dcUsd(z.valueUsd)}`,
  }));

  const positions = zones.zones.reduce((sum, z) => sum + z.positionCount, 0);

  return (
    <AllocationFrame
      title="Распределение по зонам"
      meta={`${countLabel(zones.zones.length, "зона", "зоны", "зон")} · ${countLabel(positions, "позиция", "позиции", "позиций")}`}
    >
      <AllocationSegments
        segments={segments}
        ariaLabel={`Распределение по зонам: ${withShare
          .map((z) => `${z.label} ${tablePct(z.percent, 1)}`)
          .join(", ")}`}
      />
    </AllocationFrame>
  );
}

/** Разрез по категориям активов + метки целевых долей. */
export function CategoryAllocation({
  rows,
  portfolioUsd,
  positionsUsd,
}: {
  rows: PortfolioRowDto[];
  portfolioUsd: number;
  positionsUsd: number | null;
}) {
  const segments: AllocationSegment[] = rows
    .filter((r) => r.percent > 0)
    .map((r) => ({
      key: r.category,
      percent: r.percent,
      color: CATEGORY_VAR[r.category],
      textColor: assetTextColor(r.category),
      label: tablePct(r.percent),
      title: `${r.label} — ${dcUsd(r.amountUsd)}`,
    }));

  // Метки стоят на кумулятивных границах целей: совпадение стыка с меткой
  // и есть «портфель в балансе», расхождение видно как сдвиг
  const markers: TargetMarker[] = [];
  let cumulative = 0;
  for (const row of rows.slice(0, -1)) {
    if (row.targetPercent === null) break;
    cumulative += row.targetPercent;
    markers.push({
      key: row.category,
      x: cumulative,
      title: `Цель ${row.label}: ${tablePct(row.targetPercent)}`,
    });
  }

  return (
    <AllocationFrame
      title="Распределение по активам"
      meta={
        positionsUsd === null || positionsUsd === 0
          ? undefined
          : `портфель ${dcUsd(portfolioUsd)} · размещено в позициях ${dcUsd(positionsUsd)}`
      }
    >
      <AllocationSegments
        segments={segments}
        markers={markers}
        ariaLabel={`Распределение по активам: ${rows
          .map(
            (r) =>
              `${r.label} ${tablePct(r.percent)}` +
              (r.targetPercent === null
                ? ""
                : ` при цели ${tablePct(r.targetPercent)}`),
          )
          .join(", ")}`}
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px]">
        {rows.map((r) => (
          <span key={r.category} className="flex items-center gap-[7px]">
            <span
              aria-hidden
              className="size-[6px] shrink-0 rounded-full"
              style={{ background: CATEGORY_VAR[r.category] }}
            />
            <span className="text-text-2">{r.label}</span>
            <span>{tablePct(r.percent)}</span>
            {r.targetPercent !== null && (
              <>
                <span aria-hidden className="text-text-4">
                  →
                </span>
                <span className="text-text-3">
                  цель {tablePct(r.targetPercent)}
                </span>
              </>
            )}
          </span>
        ))}
        {markers.length > 0 && (
          <span className="ml-auto flex items-center gap-[7px] text-text-3">
            <span
              aria-hidden
              className="h-[11px] w-[2px] bg-text-1 opacity-75"
            />
            метки целей
          </span>
        )}
      </div>
    </AllocationFrame>
  );
}
