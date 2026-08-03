import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Полосы данных (дизайн-код §5): высота 7px, радиус 4px, зазор 2px.
 * Цвета берутся только из «данных» — активы, зоны, свои/заёмные.
 * Семантике (profit/loss) полосу не отдают: полоса показывает состав,
 * а не результат.
 */

export interface Segment {
  key: string;
  /** Доля в процентах от целого. */
  percent: number;
  color: string;
  label?: string;
  /** Готовая подпись значения: сумма, количество токена. */
  value?: string;
}

export function DataBar({
  segments,
  height,
  ariaLabel,
  className,
}: {
  segments: Segment[];
  /** По умолчанию 7px; полоса аллокации в hero — 34px. */
  height?: number;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn("flex gap-[2px]", className)}
      style={{ height: height ?? "var(--bar-h)" }}
    >
      {segments.map((s) => (
        <div
          key={s.key}
          className="rounded-[var(--bar-radius)]"
          style={{
            width: `${s.percent}%`,
            // Доля меньше процента иначе исчезает совсем
            minWidth: s.percent > 0 ? 3 : 0,
            background: s.color,
          }}
        />
      ))}
    </div>
  );
}

/** Легенда полосы: точка цвета → подпись → значение. */
export function BarLegend({
  segments,
  className,
}: {
  segments: Segment[];
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-wrap gap-x-4 gap-y-1 text-[12px]", className)}>
      {segments.map((s) => (
        <div key={s.key} className="flex items-baseline gap-1.5">
          <span
            aria-hidden
            className="size-[6px] shrink-0 translate-y-px rounded-full"
            style={{ background: s.color }}
          />
          <dt className="text-text-3">{s.label}</dt>
          <dd className="text-text-1">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Блок «полоса + подпись сверху» — состав, чьи деньги, доли. */
export function BarBlock({
  label,
  total,
  segments,
  ariaLabel,
  className,
}: {
  label: string;
  /** Итог справа от подписи; опустить, если итог дублирует метрику. */
  total?: ReactNode;
  segments: Segment[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={cn("bg-sunken px-card py-3.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">{label}</span>
        {total != null && <span className="text-[12px] text-text-2">{total}</span>}
      </div>
      <DataBar segments={segments} ariaLabel={ariaLabel} className="mt-2.5" />
      <BarLegend segments={segments} className="mt-2.5" />
    </div>
  );
}

/**
 * Полоса диапазона цены LP: трек --bg-raised, активный участок —
 * градиент Yield → Stability, маркер текущей цены 2×21px с пилюлей-подписью.
 * `position` — где стоит цена внутри трека, 0…100; за границами обрезается,
 * маркер прижимается к краю и статус берёт на себя чип «вне диапазона».
 */
export function RangeBar({
  lowPercent,
  highPercent,
  position,
  priceLabel,
  lowLabel,
  highLabel,
  className,
}: {
  lowPercent: number;
  highPercent: number;
  position: number;
  priceLabel: string;
  lowLabel: ReactNode;
  highLabel: ReactNode;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, position));
  return (
    <div className={cn("bg-sunken px-card py-3.5", className)}>
      <div className="relative mt-6 h-[7px] rounded-[var(--bar-radius)] bg-raised">
        <div
          className="absolute inset-y-0 rounded-[var(--bar-radius)]"
          style={{
            left: `${lowPercent}%`,
            width: `${Math.max(0, highPercent - lowPercent)}%`,
            background:
              "linear-gradient(90deg, var(--zone-yield), var(--zone-stability))",
          }}
        />
        <div
          className="-translate-x-1/2 absolute top-[-7px] w-[2px] rounded-[1px] bg-text-1"
          style={{ left: `${clamped}%`, height: 21 }}
        >
          <span className="-translate-x-1/2 -top-[22px] absolute left-1/2 whitespace-nowrap rounded-pill border border-line-strong bg-raised px-1.5 py-0.5 font-mono text-[11.5px] text-text-1 leading-[1.3]">
            {priceLabel}
          </span>
        </div>
      </div>
      <div className="mt-3 flex justify-between text-[12px] text-text-3">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

/**
 * Полоса «Запас прочности» по health factor: красная зона ликвидации,
 * жёлтая опасная, дальше нейтральный трек. Маркер «сейчас» 2×15px
 * цветом текущего статуса с гало.
 *
 * `liquidationPercent`/`dangerPercent` — границы зон в процентах ширины,
 * `position` — где стоит текущий HF.
 */
export function SafetyBar({
  liquidationPercent,
  dangerPercent,
  position,
  tone,
  labels,
  className,
}: {
  liquidationPercent: number;
  dangerPercent: number;
  position: number;
  tone: "profit" | "warn" | "loss";
  /** Подписи под полосой: ликвидация / опасно / сейчас / безопасно. */
  labels: ReactNode;
  className?: string;
}) {
  const color = `var(--${tone})`;
  const clamped = Math.min(100, Math.max(0, position));
  return (
    <div className={cn("bg-sunken px-card py-3.5", className)}>
      <div
        className="relative h-[7px] rounded-[var(--bar-radius)]"
        style={{
          background: `linear-gradient(90deg, var(--loss) 0%, var(--loss) ${liquidationPercent}%, var(--warn) ${liquidationPercent}%, var(--warn) ${dangerPercent}%, var(--bg-raised) ${dangerPercent}%)`,
        }}
      >
        <div
          className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 w-[2px] rounded-[1px]"
          style={{
            left: `${clamped}%`,
            height: 15,
            background: color,
            boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 14%, transparent)`,
          }}
        />
      </div>
      <div className="mt-3 flex justify-between text-[12px] text-text-3">
        {labels}
      </div>
    </div>
  );
}
