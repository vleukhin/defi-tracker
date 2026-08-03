"use client";

import type { PortfolioRowDto } from "@/lib/api/types";
import {
  DEVIATION_THRESHOLD_PP,
  dcPp,
  dcUsd,
  dcUsdSigned,
  tablePct,
  tablePctSigned,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { AccentCard } from "./accent-card";
import { CATEGORY_VAR, CategoryDot } from "./category";

/**
 * Карточки категорий: «в чём лежит капитал» и насколько это расходится
 * с целевой долей.
 *
 * Цвет актива — только кромка сверху 2px и точка (§2: заливать карточку
 * цветом данных нельзя). Единственное крупное число в карточке — сумма;
 * доля, цель и P/L набраны мелко и спорить с ней не могут.
 */
export function MetricCards({ rows }: { rows: PortfolioRowDto[] }) {
  return (
    <section className="grid gap-3 md:grid-cols-3">
      {rows.map((row) => (
        <CategoryCard key={row.category} row={row} />
      ))}
    </section>
  );
}

function CategoryCard({ row }: { row: PortfolioRowDto }) {
  const beyond =
    row.percentDiff !== null &&
    Math.abs(row.percentDiff) > DEVIATION_THRESHOLD_PP;
  const pnl = row.ledger.unrealizedPnlUsd;

  return (
    <AccentCard color={CATEGORY_VAR[row.category]}>
      <div className="flex items-center gap-2">
        <CategoryDot category={row.category} size={7} />
        <h3 className="text-[14px] font-semibold tracking-[-0.01em]">
          {row.label}
        </h3>
        <span className="ml-auto text-[13px] font-medium text-text-2">
          {tablePct(row.percent)}
        </span>
      </div>

      <p className="mt-3.5 t-metric-lg">
        {dcUsd(row.amountUsd)}
      </p>

      <p className="mt-2 flex flex-wrap items-center gap-x-[7px] text-[12.5px] text-text-3">
        <span>
          {row.targetPercent === null
            ? "цель не задана"
            : `цель ${tablePct(row.targetPercent)}`}
        </span>
        {row.percentDiff !== null && (
          <>
            <span aria-hidden className="text-text-4">
              ·
            </span>
            <span className={cn(beyond && "text-warn")}>
              {dcPp(row.percentDiff)}
            </span>
          </>
        )}
      </p>

      <p className="mt-2 flex flex-wrap items-center gap-x-[7px] text-[12.5px]">
        <span className="text-text-3">P/L</span>
        {pnl === null ? (
          <span className="text-text-3">—</span>
        ) : (
          <span
            className={cn(
              "font-medium whitespace-nowrap",
              pnl > 0 && "text-profit",
              pnl < 0 && "text-loss",
              pnl === 0 && "text-text-2",
            )}
          >
            {dcUsdSigned(pnl)}
            {row.ledger.unrealizedPnlPct !== null && (
              <>
                {" · "}
                {tablePctSigned(row.ledger.unrealizedPnlPct, 1)}
              </>
            )}
          </span>
        )}
      </p>
    </AccentCard>
  );
}
