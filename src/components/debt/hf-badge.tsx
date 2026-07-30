"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { DebtSummaryDto } from "@/lib/api/types";
import { NBSP } from "@/lib/format";
import {
  DEBT_UNREAD_HINT,
  formatHf,
  hfStatus,
  hfTitle,
  type HfStatus,
} from "./hf";

/**
 * Постоянный HF-бейдж в шапке дашборда (S4.3): индикатор, за которым
 * следят ежедневно, не должен появляться лишь в момент, когда уже поздно.
 * Клик ведет на экран «Долг». Смысл дублируется словами в title —
 * цвет никогда не единственный признак.
 */

const BADGE_VARIANT: Record<
  HfStatus,
  "success" | "warning" | "destructive" | "muted"
> = {
  ok: "success",
  warning: "warning",
  below: "destructive",
  none: "muted",
};

export function HfBadge({ summary }: { summary: DebtSummaryDto | null }) {
  // /api/debt еще не загрузился (или упал) — не мигать пустым бейджем
  if (summary === null) return null;

  // Кошельки есть, а долг ни разу не прочитан: «нет данных», не «нет долга»
  if (summary.totalDebtUsd === null) {
    return (
      <Badge asChild variant="muted" className="font-mono">
        <Link href="/debt" title={DEBT_UNREAD_HINT}>
          HF{NBSP}—
        </Link>
      </Badge>
    );
  }

  const status = hfStatus(summary.minHealthFactor, summary.hfWarningThreshold);
  const title = hfTitle(status, summary.hfWarningThreshold);

  return (
    <Badge asChild variant={BADGE_VARIANT[status]} className="font-mono">
      <Link href="/debt" title={title} aria-label={`HF ${formatHf(summary.minHealthFactor)}: ${title}`}>
        HF{NBSP}
        {formatHf(summary.minHealthFactor)}
      </Link>
    </Badge>
  );
}
