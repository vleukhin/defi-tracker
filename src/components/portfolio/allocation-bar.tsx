"use client";

import type { ReactNode } from "react";
import { zoneColor, zoneTextColor } from "@/components/dc/chip";
import { DataTip } from "@/components/dc/data-tip";
import type {
  PortfolioRowDto,
  ZoneBreakdownDto,
  ZonesSummaryDto,
} from "@/lib/api/types";
import { DEVIATION_THRESHOLD_PP, dcPp, dcUsd, tablePct } from "@/lib/format";
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
 *
 * Полоса СПЛОШНАЯ: сегменты стыкуются встык, скругление только по краям.
 * Раньше у каждого были своё скругление, зазор 3px и обводка ярче заливки —
 * три отдельных контрола вместо разреза одного целого.
 *
 * Целей на полосе нет. Засечки протыкали её насквозь белыми палками без
 * подписи, и объясняла их сноска «метки целей» в углу легенды — подпись
 * к подписи. Вопрос «мимо ли цели» отвечается числом в легенде, тем же
 * отклонением в пунктах и с тем же порогом, что на экране «Цели».
 */

interface AllocationSegment {
  key: string;
  percent: number;
  color: string;
  textColor: string;
  /** Доля внутри сегмента — то, что видно без наведения. */
  label: string;
  /** Что это: «BTC», «Growth». Заголовок подсказки. */
  tipTitle: string;
  /** Сумма и доля — то, ради чего наводят. */
  tipValue: ReactNode;
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
  ariaLabel,
}: {
  segments: AllocationSegment[];
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
    // Сегменты встык и скруглены только по краям всей полосы: это разрез
    // одного целого, а не три отдельных контрола. Щель в 2px между ними —
    // фон карточки, он же отделяет соседние цвета друг от друга.
    // Скругление вешается на крайние сегменты, а не overflow-hidden
    // на контейнер: последний срезал бы кольцо фокуса.
    <div className="flex h-[34px] gap-[2px]" role="img" aria-label={ariaLabel}>
      {segments.map((s) => (
        <DataTip key={s.key} title={s.tipTitle} value={s.tipValue}>
          {/* Кнопка, а не div: подсказка открывается и по focus, иначе
              сумма сегмента недостижима с клавиатуры и на тач-экране */}
          <button
            type="button"
            aria-label={`${s.tipTitle}, ${s.label}`}
            className="flex items-center overflow-hidden px-[11px] text-left outline-none first:rounded-l-pill last:rounded-r-pill focus-visible:ring-3 focus-visible:ring-ring/50"
            style={{
              width: `${s.percent}%`,
              // Доля меньше процента иначе схлопывается в невидимую полоску
              minWidth: s.percent > 0 ? 10 : 0,
              // Заливка плотнее прежней и без обводки: раньше рамка была
              // ярче заливки, и сегмент читался пустой рамкой, а не массой
              background: `linear-gradient(180deg, color-mix(in srgb, ${s.color} 30%, transparent), color-mix(in srgb, ${s.color} 16%, transparent))`,
            }}
          >
            {/* Узкий сегмент на 375px обрезал бы процент до «1…» —
                на таких ширинах подпись уходит в легенду */}
            <span
              className={cn(
                "truncate text-[12.5px] font-medium",
                s.percent < 25 && "hidden sm:inline",
              )}
              style={{ color: s.textColor }}
            >
              {s.label}
            </span>
          </button>
        </DataTip>
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

  // Точность доли — по умолчанию tablePct (два знака), как в разрезе по
  // активам. Раньше зоны показывали один знак, и переключатель «Активы ↔
  // Зоны» менял точность в той же карточке на том же месте
  const segments: AllocationSegment[] = withShare.map((z) => ({
    key: z.zone,
    percent: z.percent,
    color: zoneColor(z.zone),
    textColor: zoneTextColor(z.zone),
    label: tablePct(z.percent),
    tipTitle: z.label,
    tipValue: `${z.valueUsd === null ? "—" : dcUsd(z.valueUsd)} · ${tablePct(z.percent)}`,
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
          .map((z) => `${z.label} ${tablePct(z.percent)}`)
          .join(", ")}`}
      />
    </AllocationFrame>
  );
}

/** Разрез по категориям активов; цели названы в легенде отклонением. */
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
      tipTitle: r.label,
      tipValue: (
        <>
          {dcUsd(r.amountUsd)} · {tablePct(r.percent)}
          {r.targetPercent !== null && (
            <span className="mt-0.5 block text-[11.5px] font-normal text-text-3">
              цель {tablePct(r.targetPercent)}
            </span>
          )}
        </>
      ),
    }));

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

      {/* Легенда отвечает на вопрос «мимо ли цели», а не повторяет полосу:
          отклонение в пунктах названо числом, а не белой засечкой поверх
          сегментов, к которой нужна была ещё и сноска «метки целей» */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px]">
        {rows.map((r) => {
          const diff =
            r.targetPercent === null ? null : r.percent - r.targetPercent;
          return (
            <span key={r.category} className="flex items-center gap-[7px]">
              <span
                aria-hidden
                className="size-[6px] shrink-0 rounded-full"
                style={{ background: CATEGORY_VAR[r.category] }}
              />
              <span className="text-text-2">{r.label}</span>
              {/* Доля дублируется сюда ровно там, где сегмент её не показал:
                  узкий сегмент прячет подпись до sm, и без этого число
                  осталось бы только в подсказке */}
              <span className={r.percent < 25 ? "sm:hidden" : "hidden"}>
                {tablePct(r.percent)}
              </span>
              {diff === null ? (
                <span className="text-text-3">цель не задана</span>
              ) : (
                <>
                  <span className="text-text-3">
                    цель {tablePct(r.targetPercent!)}
                  </span>
                  {/* Порог тот же, что на экране «Цели»: цвет отклонения
                      обязан означать одно и то же в обоих местах */}
                  <span
                    className={cn(
                      "font-mono",
                      Math.abs(diff) > DEVIATION_THRESHOLD_PP
                        ? "text-warn"
                        : "text-text-2",
                    )}
                  >
                    {dcPp(diff)}
                  </span>
                </>
              )}
            </span>
          );
        })}
      </div>
    </AllocationFrame>
  );
}
