import type { PortfolioRowDto } from "@/lib/api/types";
import { formatPnl, pnlClass } from "@/components/pnl";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DEVIATION_THRESHOLD_PP,
  tablePct,
  tablePctSigned,
  tableUsd,
  tableUsdSigned,
  usdDecimals,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { CategoryDot, categoryTint } from "./category";

/**
 * Карточки-метрики категорий (ТЗ §5.1.3): фон с категорийным тинтом,
 * бейдж отклонения, стоимость и «доля → цель». Итог в карточку не выносится
 * (он в шапке). Карточки некликабельны, hover-эффектов нет.
 * На мобильных (< sm) — мини-версия в три колонки (ТЗ §5.1.7).
 */
export function MetricCards({ rows }: { rows: PortfolioRowDto[] }) {
  return (
    <>
      <div className="hidden gap-3 sm:grid sm:grid-cols-3">
        {rows.map((row) => (
          <MetricCard key={row.category} row={row} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:hidden">
        {rows.map((row) => (
          <MiniMetricCard key={row.category} row={row} />
        ))}
      </div>
    </>
  );
}

function isBeyondThreshold(row: PortfolioRowDto): boolean {
  return (
    row.percentDiff !== null &&
    Math.abs(row.percentDiff) > DEVIATION_THRESHOLD_PP
  );
}

function MetricCard({ row }: { row: PortfolioRowDto }) {
  return (
    <Card
      className="space-y-1.5 p-4"
      style={{ background: categoryTint(row.category) }}
    >
      <div className="flex items-center gap-2">
        <CategoryDot category={row.category} />
        <span className="text-sm font-medium">{row.label}</span>
        {row.percentDiff !== null && (
          <Badge
            variant={isBeyondThreshold(row) ? "warning" : "muted"}
            className="ml-auto font-mono"
          >
            {tablePctSigned(row.percentDiff)}
          </Badge>
        )}
      </div>
      <p className="font-mono text-lg font-semibold">
        {tableUsd(row.amountUsd)}
      </p>
      <p className="font-mono text-xs text-muted-foreground">
        {row.targetPercent === null
          ? tablePct(row.percent)
          : `${tablePct(row.percent)} → цель ${tablePct(row.targetPercent)}`}
      </p>
      {/* Unrealized P/L из леджера сделок (Фаза 2, S2.2); без сделок — нет строки */}
      {row.ledger.unrealizedPnlUsd !== null && (
        <p
          className={cn(
            "font-mono text-xs",
            pnlClass(row.ledger.unrealizedPnlUsd) || "text-muted-foreground",
          )}
        >
          P/L:{" "}
          {/* nowrap: перенос внутри числа после «−» ломает чтение */}
          <span className="whitespace-nowrap">
            {formatPnl(
              row.ledger.unrealizedPnlUsd,
              row.ledger.unrealizedPnlPct,
            )}
          </span>
        </p>
      )}
    </Card>
  );
}

/** Мини-карточка 375px: бейдж заменяется цветом доли (ТЗ §5.1.7). */
function MiniMetricCard({ row }: { row: PortfolioRowDto }) {
  return (
    <Card
      className="space-y-1 p-3"
      style={{ background: categoryTint(row.category) }}
    >
      <div className="flex items-center gap-1.5">
        <CategoryDot category={row.category} />
        <span className="truncate text-xs">{row.label}</span>
      </div>
      <p className="font-mono text-sm font-semibold">
        {tableUsd(row.amountUsd)}
      </p>
      <p
        className={cn(
          "font-mono text-[11px]",
          isBeyondThreshold(row) ? "text-warning" : "text-muted-foreground",
        )}
      >
        {tablePct(row.percent)}
      </p>
      {/* Мини-версия P/L: только доллары — проценты не влезают в треть 375px */}
      {row.ledger.unrealizedPnlUsd !== null && (
        <p
          className={cn(
            "font-mono text-[11px]",
            pnlClass(row.ledger.unrealizedPnlUsd) || "text-muted-foreground",
          )}
        >
          P/L:{" "}
          <span className="whitespace-nowrap">
            {tableUsdSigned(
              row.ledger.unrealizedPnlUsd,
              usdDecimals(row.ledger.unrealizedPnlUsd),
            )}
          </span>
        </p>
      )}
    </Card>
  );
}
