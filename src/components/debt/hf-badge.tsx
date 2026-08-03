"use client";

import Link from "next/link";
import type { DebtSummaryDto } from "@/lib/api/types";
import { NBSP, tableNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DEBT_UNREAD_HINT, formatHf, hfTitle, hfStatus } from "./hf";
import { hfTone } from "./risk";

/**
 * Постоянный HF-индикатор в hero портфеля (S4.3): показатель, за которым
 * следят ежедневно, не должен появляться лишь в момент, когда уже поздно.
 * Клик ведёт на экран «Долг».
 *
 * Пилюля дизайн-кода (README §1, «Health Factor блок»): заливка 8% цвета
 * семантики, обводка 20%, точка 6px, значение Mono 15px, порог тем же
 * цветом с opacity .75. Ниже порога слои перекрашиваются в warn, ниже
 * 1,2 — в loss. Смысл дублируется словами в title: цвет никогда
 * не единственный признак.
 */
export function HfBadge({ summary }: { summary: DebtSummaryDto | null }) {
  // /api/debt ещё не загрузился (или упал) — не мигать пустой пилюлей
  if (summary === null) return null;

  // Кошельки есть, а долг ни разу не прочитан: «нет данных», не «нет долга»
  if (summary.totalDebtUsd === null) {
    return (
      <Pill color="var(--text-3)" href="/debt" title={DEBT_UNREAD_HINT}>
        <span className="font-mono text-[15px] leading-none">HF{NBSP}—</span>
      </Pill>
    );
  }

  const tone = hfTone(summary.minHealthFactor, summary.hfWarningThreshold);
  const title = hfTitle(
    hfStatus(summary.minHealthFactor, summary.hfWarningThreshold),
    summary.hfWarningThreshold,
  );
  const color = tone === null ? "var(--text-3)" : `var(--${tone})`;
  const value = formatHf(summary.minHealthFactor);

  return (
    <Pill
      color={color}
      href="/debt"
      title={title}
      ariaLabel={`Health factor ${value}: ${title}`}
    >
      <span
        aria-hidden
        className="size-[6px] shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className="font-mono text-[15px] leading-none">{value}</span>
      <span className="text-[12px] leading-none opacity-75">
        порог {tableNumber(summary.hfWarningThreshold, 2)}
      </span>
    </Pill>
  );
}

function Pill({
  color,
  href,
  title,
  ariaLabel,
  children,
  className,
}: {
  color: string;
  href: string;
  title: string;
  ariaLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-2 whitespace-nowrap rounded-chip py-[5px] pr-2.5 pl-2 font-medium transition-colors duration-120 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      style={{
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 20%, transparent)`,
        color,
      }}
    >
      {children}
    </Link>
  );
}
