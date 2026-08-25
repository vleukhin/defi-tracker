"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import { DcCard, SectionHead } from "@/components/dc/card";
import { DataTip } from "@/components/dc/data-tip";
import { TooltipCard } from "@/components/dc/tooltip-card";
import { ASSET_COLOR } from "@/components/dc/protocols";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { TRADE_CATEGORIES } from "@/components/trades/categories";
import type { PortfolioCategory, SnapshotDto } from "@/lib/api/types";
import { dcUsd, tableDate, tablePct } from "@/lib/format";
import {
  bandCenter,
  countMissingDays,
  dateFromDay,
  dayNumber,
  denseDays,
  timeScale,
} from "./chart-geometry";
import { ChartNote, PartialMarker } from "./chart-parts";
import {
  AXIS_TICK,
  CHART_RIGHT,
  Y_AXIS_WIDTH,
  axisDateIso,
  dayTicks,
} from "./recharts-parts";
import { HISTORY_CATEGORY_LABEL } from "./labels";

/**
 * Пропорции трёх категорий во времени на КАЛЕНДАРНОЙ оси (S3.2): столбец
 * на 100% для каждого дня со снепшотом. Дни без снепшота — пустая полоса:
 * разрыв виден сам собой, доли между снепшотами не интерполируются.
 *
 * Ось X здесь категориальная, а не числовая, как у линейных графиков:
 * ширину столбца задаёт полоса категории, и своей полосы у дня иначе нет.
 * Позиция при этом та же — центр дневной полосы, поэтому подписи дат
 * стоят на одних вертикалях с графиками стоимости и прибыли.
 *
 * Цвета — только активов (дизайн-код §5, «полосы данных»).
 */

const COMPOSITION_HINT =
  "Доли категорий в стоимости портфеля на каждую дату. Пропорции показывают, куда сместился капитал, — количества монет при этом могли не меняться.";

/** Ось долей всегда 0…100: у процентов свой предел, подбирать его нечего. */
const PCT_TICKS = [0, 25, 50, 75, 100];

/**
 * Зазор между столбцами есть, только пока столбцы различимы глазом.
 * На дневной полосе в полпикселя он даёт не ритм, а рябь швов — лента
 * состава должна читаться сплошной, а не полосатой.
 */
const DENSE_SPAN = 45;

const CHART_CONFIG = {
  btc: { label: "BTC", color: ASSET_COLOR.btc },
  eth: { label: "ETH", color: ASSET_COLOR.eth },
  stable: { label: "Стейблы", color: ASSET_COLOR.stable },
} satisfies ChartConfig;

interface Slice {
  category: PortfolioCategory;
  /** Доля в процентах, нормированная так, что сумма = 100. */
  pct: number;
  valueUsd: number;
}

/**
 * Доли снепшота, нормированные к 100%: проценты в составе округлены
 * и в сумме дают 99,99 — полоса не должна упираться в белую щель сверху.
 */
function slices(snapshot: SnapshotDto): Slice[] {
  const raw = TRADE_CATEGORIES.map((c) => {
    const item = snapshot.items.find((i) => i.category === c.key);
    return {
      category: c.key,
      pct: item?.percent ?? 0,
      valueUsd: item?.valueUsd ?? 0,
    };
  });
  const sum = raw.reduce((acc, s) => acc + s.pct, 0);
  if (sum <= 0) return raw;
  return raw.map((s) => ({ ...s, pct: (s.pct / sum) * 100 }));
}

/** Строка графика: день календаря и доли категорий в нём. */
interface CompositionRow {
  takenOn: string;
  btc: number | null;
  eth: number | null;
  stable: number | null;
  snapshot: SnapshotDto | null;
  parts: Slice[] | null;
}

export function CompositionChart({
  snapshots,
  periodLabel,
}: {
  snapshots: SnapshotDto[];
  periodLabel: string;
}) {
  const scale = timeScale(snapshots)!;
  const days = denseDays(snapshots);
  const rows: CompositionRow[] = days.map((day) => {
    if (day.point === null) {
      return {
        takenOn: day.takenOn,
        btc: null,
        eth: null,
        stable: null,
        snapshot: null,
        parts: null,
      };
    }
    const parts = slices(day.point);
    const by = (key: PortfolioCategory) =>
      parts.find((p) => p.category === key)?.pct ?? 0;
    return {
      takenOn: day.takenOn,
      btc: by("btc"),
      eth: by("eth"),
      stable: by("stable"),
      snapshot: day.point,
      parts,
    };
  });

  const firstDay = dayNumber(snapshots[0].takenOn);
  const lastDay = dayNumber(snapshots[snapshots.length - 1].takenOn);
  const span = lastDay - firstDay + 1;
  const ticks = dayTicks(firstDay, lastDay).map(dateFromDay);

  const missing = countMissingDays(snapshots);
  const anyPartial = snapshots.some((s) => s.isPartial);
  const lastSlices = slices(snapshots[snapshots.length - 1]);

  const ariaLabel =
    `Пропорции категорий, ${periodLabel}. ` +
    `На ${tableDate(snapshots[snapshots.length - 1].takenOn)}: ` +
    lastSlices
      .map((s) => `${HISTORY_CATEGORY_LABEL[s.category]} ${tablePct(s.pct)}`)
      .join(", ") +
    (missing > 0 ? `. Дней без снепшота: ${missing}` : "");

  return (
    <DcCard as="section">
      <SectionHead
        title="Пропорции категорий"
        hint={COMPOSITION_HINT}
        className="border-line border-b"
        action={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {lastSlices.map((slice) => (
              <span
                key={slice.category}
                className="inline-flex items-center gap-1.5"
              >
                <span
                  aria-hidden
                  className="size-[7px] shrink-0 rounded-full"
                  style={{ background: ASSET_COLOR[slice.category] }}
                />
                <span className="t-meta text-text-2">
                  {HISTORY_CATEGORY_LABEL[slice.category]}
                </span>
                <span className="t-meta font-mono">{tablePct(slice.pct)}</span>
              </span>
            ))}
          </div>
        }
      />

      <div className="bg-sunken px-3 pt-3 pb-2">
        {/* Полоса меток частичных точек — НАД столбцами: поверх заливки
            категорий полая метка была бы неразличима. Ширина повторяет
            поле графика (ось Y слева, отступ под активную точку справа),
            поэтому метка стоит ровно над своим столбцом */}
        {anyPartial && (
          <div
            className="relative h-3"
            style={{
              marginLeft: Y_AXIS_WIDTH,
              marginRight: CHART_RIGHT,
            }}
          >
            {snapshots.map((snapshot) =>
              snapshot.isPartial ? (
                <DataTip
                  key={`partial-${snapshot.takenOn}`}
                  title={tableDate(snapshot.takenOn)}
                  value="частичные данные"
                >
                  {/* Метка 10px, а палец попадает в 44px: hit-зона
                      растягивается псевдоэлементом, как у «?» */}
                  <button
                    type="button"
                    aria-label={`${tableDate(snapshot.takenOn)}: частичные данные`}
                    style={{ left: `${bandCenter(scale, snapshot.takenOn)}%` }}
                    className="absolute top-0 -translate-x-1/2 rounded-full outline-none before:absolute before:top-1/2 before:left-1/2 before:size-[14px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:before:size-11"
                  >
                    <PartialMarker className="block" />
                  </button>
                </DataTip>
              ) : null,
            )}
          </div>
        )}

        <div className="h-[186px] sm:h-[226px]">
          <ChartContainer
            config={CHART_CONFIG}
            role="figure"
            aria-label={ariaLabel}
            className="aspect-auto h-full w-full"
          >
            <BarChart
              data={rows}
              margin={{ top: 8, right: CHART_RIGHT, bottom: 0, left: 0 }}
              barCategoryGap={span > DENSE_SPAN ? 0 : "14%"}
            >
              <CartesianGrid vertical={false} stroke="var(--line-strong)" />

              <XAxis
                dataKey="takenOn"
                scale="band"
                ticks={ticks}
                tickFormatter={(iso: string) => axisDateIso(iso, span)}
                interval="preserveStartEnd"
                minTickGap={26}
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                height={30}
                tick={AXIS_TICK}
              />
              <YAxis
                domain={[0, 100]}
                ticks={PCT_TICKS}
                width={Y_AXIS_WIDTH}
                tickFormatter={(value: number) => `${value}%`}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={AXIS_TICK}
              />

              <ChartTooltip
                cursor={{ fill: "var(--bg-raised)", fillOpacity: 0.45 }}
                offset={14}
                wrapperStyle={{ outline: "none", zIndex: 10 }}
                isAnimationActive={false}
                content={(props: TooltipContentProps) => (
                  <CompositionTooltip {...props} />
                )}
              />

              {/* Порядок детей — снизу вверх: стейблы в основании,
                  BTC сверху, как в легенде и в полосах на «Портфеле» */}
              <Bar dataKey="stable" stackId="c" fill={ASSET_COLOR.stable} />
              <Bar dataKey="eth" stackId="c" fill={ASSET_COLOR.eth} />
              <Bar
                dataKey="btc"
                stackId="c"
                fill={ASSET_COLOR.btc}
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        </div>
      </div>

      <ChartNote
        missing={missing}
        anyPartial={anyPartial}
        className="border-line border-t px-card py-3"
      />
    </DcCard>
  );
}

/** Долям нужен весь состав сразу: одна доля без соседних ничего не значит. */
function CompositionTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as CompositionRow | undefined;
  if (!row?.snapshot || !row.parts) return null;

  return (
    <TooltipCard
      title={`${tableDate(row.takenOn)} · ${dcUsd(row.snapshot.totalUsd)}`}
      note={row.snapshot.isPartial ? "частичные данные" : undefined}
    >
      <span className="grid gap-0.5 text-[13px]">
        {row.parts.map((slice) => (
          <span key={slice.category} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-[7px] shrink-0 rounded-full"
              style={{ background: ASSET_COLOR[slice.category] }}
            />
            <span className="font-sans font-normal text-text-2">
              {HISTORY_CATEGORY_LABEL[slice.category]}
            </span>
            <span className="ml-auto pl-3 font-mono">
              {tablePct(slice.pct)}
            </span>
          </span>
        ))}
      </span>
    </TooltipCard>
  );
}
