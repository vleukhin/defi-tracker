"use client";

import { Badge } from "@/components/ui/badge";
import { pnlClass } from "@/components/pnl";
import type { PositionDto, StableBorrowRateDto } from "@/lib/api/types";
import {
  tablePctSigned,
  tableUsd,
  tableUsdSigned,
  usdDecimals,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { FluidCard } from "./fluid-card";
import { MarkPopover } from "./mark-popover";
import { LABEL, ZoneChip, type MarkFn } from "./shared";

/**
 * Карточка позиции. Разбор идет по протоколу: у депозита лендинга и у пула
 * ликвидности разные вопросы к позиции, и общая строка отвечала на них
 * одинаково плохо — Fluid живет ставкой, а GM переоценкой.
 *
 * Пока своя карточка есть только у Fluid; остальные протоколы показываются
 * общей карточкой, из которой они и вырастут.
 */
export function PositionCard({
  position,
  busy,
  onMark,
  stableBorrow,
}: {
  position: PositionDto;
  busy: boolean;
  onMark: MarkFn;
  stableBorrow: StableBorrowRateDto;
}) {
  if (position.protocol === "fluid") {
    return (
      <FluidCard
        position={position}
        busy={busy}
        onMark={onMark}
        stableBorrow={stableBorrow}
      />
    );
  }
  return <GenericCard position={position} busy={busy} onMark={onMark} />;
}

/** Позиция без своей карточки: что это, как размечено и что принесло. */
function GenericCard({
  position,
  busy,
  onMark,
}: {
  position: PositionDto;
  busy: boolean;
  onMark: MarkFn;
}) {
  const unmarked =
    position.ownPrincipalUsd === null || position.borrowedPrincipalUsd === null;

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm">{position.title}</span>
          <ZoneChip zone={position.zone} />
          {unmarked && <Badge variant="warning">не размечено</Badge>}
        </div>

        <p className="truncate text-xs text-muted-foreground">
          {position.protocolLabel}
          {" · стоит "}
          {position.valueUsd === null ? "—" : tableUsd(position.valueUsd)}
          {position.ownCurrentUsd !== null && !unmarked && (
            <>
              {" · своих сейчас "}
              {tableUsd(position.ownCurrentUsd)}
            </>
          )}
        </p>

        {/* Разметка ушла в поповер, но остается фактом о позиции: без нее
            не прочитать ни доход, ни собственную долю */}
        <p className="text-xs text-muted-foreground">
          {"Вложено: свои "}
          <Amount value={position.ownPrincipalUsd} />
          {" · заемные "}
          <Amount value={position.borrowedPrincipalUsd} />
          {position.withdrawnUsd !== null && position.withdrawnUsd > 0 && (
            <>
              {" · выведено "}
              <Amount value={position.withdrawnUsd} />
            </>
          )}
        </p>
      </div>

      <div className="flex items-start gap-1">
        <div className="text-right">
          <span className={cn(LABEL, "block")}>Доход</span>
          <ProfitValue position={position} />
        </div>
        <MarkPopover position={position} busy={busy} onMark={onMark} />
      </div>
    </li>
  );
}

/** Сумма разметки; «—» означает «не сказали», а не ноль. */
export function Amount({ value }: { value: number | null }) {
  if (value === null) return <span>—</span>;
  return <span className="font-mono">{tableUsd(value)}</span>;
}

/**
 * Доход = стоимость + выведено − вложено. Пока размечена лишь часть,
 * показать его нельзя: остаток мог бы оказаться незаявленной заемной долей.
 */
export function ProfitValue({
  position,
  className,
}: {
  position: PositionDto;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-sm font-semibold",
        position.profitUsd === null
          ? "text-muted-foreground"
          : pnlClass(position.profitUsd),
        className,
      )}
      title={
        position.profitUsd === null
          ? "Размечены не обе вложенные суммы — доход не выводится"
          : undefined
      }
    >
      {position.profitUsd === null
        ? "—"
        : tableUsdSigned(position.profitUsd, usdDecimals(position.profitUsd))}
      {position.profitPct !== null && (
        <span className="ml-1.5 text-xs font-normal">
          ({tablePctSigned(position.profitPct, 1)})
        </span>
      )}
    </span>
  );
}
