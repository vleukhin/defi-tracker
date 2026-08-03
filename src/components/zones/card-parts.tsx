"use client";

import { Children, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { PositionDto } from "@/lib/api/types";
import { tableNumber, tablePct, tableUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MarkPopover } from "./mark-popover";
import { LABEL, ZoneChip, type MarkFn } from "./shared";

/**
 * Детали, из которых собраны карточки позиций.
 *
 * Карточки у протоколов разные — депозит лендинга живет ставкой, LP-позиция
 * диапазоном, — но собраны из одних и тех же деталей: шапка со знаком
 * протокола, пара крупных чисел, полоса с легендой, подвал с выводом.
 * Общий каркас держит их в одном языке и не дает каждому следующему
 * протоколу изобретать свою верстку.
 */

/** Карточка протокола: рамка и фирменный тинт (рецепт ТЗ §5.1.3). */
export function ProtocolCard({
  accent,
  children,
}: {
  accent: string;
  children: ReactNode;
}) {
  return (
    <li
      // Поверхность уровня 1 (ТЗ §3), как у Card: карточка позиции лежит
      // на фоне страницы сама по себе
      className="overflow-hidden rounded-xl border border-border shadow-sm dark:shadow-none"
      style={{ background: `color-mix(in oklab, ${accent} 6%, var(--card))` }}
    >
      {children}
    </li>
  );
}

/** Шапка: знак протокола, название, зона, пометки и кнопка разметки. */
export function CardHead({
  mark,
  name,
  subtitle,
  badges,
  position,
  busy,
  onMark,
}: {
  mark: ReactNode;
  name: string;
  subtitle: ReactNode;
  badges?: ReactNode;
  position: PositionDto;
  busy: boolean;
  onMark: MarkFn;
}) {
  return (
    <div className="flex items-start gap-3 p-4 pb-3">
      {mark}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{name}</span>
          <ZoneChip zone={position.zone} />
          {badges}
        </div>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <MarkPopover position={position} busy={busy} onMark={onMark} />
    </div>
  );
}

/** Пара крупных чисел карточки. */
export function CardMetrics({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">{children}</div>;
}

/**
 * Крупное число с подписью и пояснением. «—» вместо значения означает
 * «неизвестно» и всегда набрано приглушенным: ноль так не выглядит.
 */
export function CardMetric({
  label,
  value,
  unit,
  children,
}: {
  label: string;
  /** null = величина неизвестна. */
  value: string | null;
  /** Мелкий суффикс у числа: «годовых» и подобное. */
  unit?: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <span className={cn(LABEL, "block")}>{label}</span>
      <p
        className={cn(
          "mt-1 font-mono text-2xl leading-none font-semibold tracking-tight",
          value === null && "text-muted-foreground",
        )}
      >
        {value ?? "—"}
        {value !== null && unit && (
          <span className="ml-1.5 font-sans text-xs font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </p>
      {children && (
        <p className="mt-1.5 text-xs text-muted-foreground">{children}</p>
      )}
    </div>
  );
}

/**
 * Ряд секций с полосами. Две полосы встают рядом: и состав, и вложенное —
 * это доли одного и того же, читаются они одинаково, и растянутые на всю
 * ширину карточки только удлиняют ее. Одна полоса занимает ряд целиком.
 */
export function CardBars({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid gap-x-6 gap-y-4 px-4 pb-4",
        Children.count(children) > 1 && "sm:grid-cols-2",
      )}
    >
      {children}
    </div>
  );
}

/** Секция карточки под метриками: полоса состава, полоса вложенного. */
export function CardSection({
  label,
  value,
  children,
}: {
  label: string;
  /** Итог секции справа от подписи; null — не показывать (не «—»). */
  value?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className={LABEL}>{label}</span>
        {value != null && (
          <span className="font-mono text-sm font-semibold">{value}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Подвал: вывод по стратегии — сравнение ставок, статус диапазона. */
export function CardFooter({
  title,
  badge,
  children,
}: {
  title: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-border/60 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-xs text-muted-foreground">{title}</span>
        {badge}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * Количество токена в легенде: чем меньше число, тем больше знаков, но
 * хвостовые нули отбрасываются — «800,2000 USDC» читается хуже, чем
 * «800,2», а точности не добавляет.
 */
export function tokenQuantity(value: number): string {
  const decimals = value >= 1000 ? 0 : value >= 1 ? 4 : 6;
  const trimmed = tableNumber(value, decimals)
    .replace(/(,\d*?)0+$/, "$1")
    .replace(/,$/, "");
  // Пыль, округлившаяся до нуля: ноль сказал бы «ничего нет», а это не так
  return value > 0 && Number(trimmed.replace(/\s/g, "").replace(",", ".")) === 0
    ? "<0,000001"
    : trimmed;
}

export interface BarSegment {
  label: string;
  /** Готовая подпись: доллары у вложенного, количество токена у состава. */
  value: string;
  percent: number;
  color: string;
}

/**
 * Полоса из двух долей с легендой — та же механика, что у полосы аллокации
 * (ТЗ §5.1.4): зазор 2px, крайние сегменты скруглены наружу, доля меньше
 * процента все равно видна.
 */
export function SplitBar({
  segments,
  ariaLabel,
}: {
  segments: BarSegment[];
  ariaLabel: string;
}) {
  return (
    <>
      <div
        className="mt-2 flex h-3 gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={ariaLabel}
      >
        {segments.map((s, i) => (
          <span
            key={s.label}
            className={cn(
              "transition-[width] duration-400 ease-out",
              i === 0 && "rounded-l-full",
              i === segments.length - 1 && "rounded-r-full",
            )}
            style={{
              width: `${s.percent}%`,
              // Сегмент < 1% иначе исчезает совсем
              minWidth: s.percent > 0 ? 4 : 0,
              background: s.color,
            }}
          />
        ))}
      </div>

      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) => (
          <div key={s.label} className="flex items-baseline gap-1.5">
            <span
              aria-hidden
              className="size-2 shrink-0 translate-y-px rounded-full"
              style={{ background: s.color }}
            />
            <dt className="text-muted-foreground">{s.label}</dt>
            <dd className="font-mono">
              {s.value}
              <span className="ml-1 text-muted-foreground">
                {tablePct(s.percent, 0)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/**
 * Свои и заемные в позиции. Разделение задает разметка, а не протокол:
 * в позиции лежат и собственные стейблы, и заемные, и различить их
 * вычитанием нельзя (docs/07 §10.1).
 */
export function OwnershipBar({
  own,
  borrowed,
  accent,
}: {
  own: number | null;
  borrowed: number | null;
  /** Фирменный цвет протокола — им красится собственная доля. */
  accent: string;
}) {
  if (own === null || borrowed === null) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Своё и заёмное не размечены — доход и собственная доля не считаются.
        Разметка в кнопке справа сверху.
      </p>
    );
  }

  const principal = own + borrowed;

  if (principal === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Вложено ноль: позиция размечена как пустая.
      </p>
    );
  }

  const ownPct = (own / principal) * 100;
  const borrowedPct = 100 - ownPct;

  return (
    <SplitBar
      ariaLabel={`Вложено своих ${tableUsd(own)} (${tablePct(ownPct, 1)}), заемных ${tableUsd(borrowed)} (${tablePct(borrowedPct, 1)})`}
      segments={[
        {
          label: "свои",
          value: tableUsd(own),
          percent: ownPct,
          color: accent,
        },
        {
          label: "заемные",
          value: tableUsd(borrowed),
          percent: borrowedPct,
          color: "var(--color-muted-foreground)",
        },
      ]}
    />
  );
}

/** Пометка «не размечено» — одна на все карточки. */
export function UnmarkedBadge({ principal }: { principal: number | null }) {
  if (principal !== null) return null;
  return <Badge variant="warning">не размечено</Badge>;
}

/**
 * Знак протокола: инлайновый SVG на фирменной плитке. Страница не ходит
 * за внешними ассетами, и в темной теме знак не требует отдельного файла.
 */
export function ProtocolMark({
  from,
  to,
  children,
}: {
  from: string;
  to: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-lg"
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <svg viewBox="0 0 24 24" className="size-5">
        {children}
      </svg>
    </span>
  );
}
