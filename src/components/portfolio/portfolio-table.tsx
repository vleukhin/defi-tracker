"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { DcCard } from "@/components/dc/card";
import { HelpTip } from "@/components/dc/help-tip";
import { Dash, DcTable, Td, Th, TotalRow, Tr } from "@/components/dc/table";
import type { PortfolioRowDto } from "@/lib/api/types";
import {
  DEVIATION_THRESHOLD_PP,
  chainLabel,
  dcUsd,
  dcUsdSigned,
  tableNumber,
  tablePct,
  tablePctSigned,
  tableQuantity,
  tableSigned,
  tableUsd,
  usdDecimals,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { CategoryDot } from "./category";

/**
 * Таблица портфеля: три категории по колонкам «сколько — почём — какая
 * доля — насколько мимо цели».
 *
 * Ширины не хватает на десять колонок ниже 900px, и таблица получает
 * горизонтальный скролл, а не разваливается в список «label — значение»:
 * ради сравнения строк между собой она здесь и стоит.
 *
 * Цветом отмечено ровно две вещи: отклонение за порогом (warn) и P/L
 * (profit/loss). Строка целиком не красится никогда — отрицательный P/L
 * не делает всю категорию «плохой».
 */

const REBALANCE_HINT =
  "Сколько нужно купить или продать, чтобы вернуть долю к цели. Расчёт, а не финансовый совет.";
const NO_AVG_HINT = "нет данных о цене покупки";
const STALE_PRICE_HINT = "Цена устарела: не удалось обновить";

/** Знаков в количестве: у стейблов дробная часть не нужна. */
function amountDecimals(unit: string): number {
  return unit === "USD" ? 0 : 4;
}

/**
 * Точность количества к ребалансировке подстраивается под масштаб:
 * −0,071486 BTC нужно видеть целиком, а у −3 732,86 ETH шесть знаков
 * только ломают вёрстку.
 */
function balanceDecimals(unit: string, value: number): number {
  if (unit === "USD") return 0;
  const abs = Math.abs(value);
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  return 6;
}

/** Подсказка к знаку: минус — продать, плюс — купить. */
function balanceHint(value: number, unit: string): string {
  const body = `${tableNumber(Math.abs(value), balanceDecimals(unit, value))} ${unit}`;
  return value > 0 ? `Купить ${body}` : `Продать ${body}`;
}

function pnlClass(value: number): string {
  if (value > 0) return "text-profit";
  if (value < 0) return "text-loss";
  return "text-text-2";
}

function hasWarnings(row: PortfolioRowDto): boolean {
  return (
    row.warnings.length > 0 ||
    row.ledger.warnings.length > 0 ||
    row.ledger.discrepancy !== null
  );
}

export function PortfolioTable({
  rows,
  totalUsd,
}: {
  rows: PortfolioRowDto[];
  totalUsd: number;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const pnlRows = rows.filter((r) => r.ledger.unrealizedPnlUsd !== null);
  const totalPnl =
    pnlRows.length === 0
      ? null
      : pnlRows.reduce((sum, r) => sum + (r.ledger.unrealizedPnlUsd ?? 0), 0);

  return (
    <DcCard>
      <DcTable minWidth={980}>
        <thead>
          <tr>
            <Th>Актив</Th>
            <Th numeric>Кол-во</Th>
            <Th numeric>Стоимость</Th>
            <Th numeric>Цена</Th>
            <Th numeric>Доля</Th>
            <Th numeric>Цель</Th>
            <Th numeric>Отклон.</Th>
            <Th numeric>
              <span className="inline-flex items-center gap-1.5">
                К ребаланс.
                <HelpTip>{REBALANCE_HINT}</HelpTip>
              </span>
            </Th>
            <Th numeric>Средняя</Th>
            <Th numeric>P/L</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = open === row.category;
            const beyond =
              row.percentDiff !== null &&
              Math.abs(row.percentDiff) > DEVIATION_THRESHOLD_PP;
            const pnl = row.ledger.unrealizedPnlUsd;

            return (
              <Fragment key={row.category}>
                <Tr>
                  <Td className="font-medium">
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : row.category)}
                      aria-expanded={expanded}
                      className="flex items-center gap-2 rounded-pill text-[13.5px] outline-none transition-colors duration-120 ease-out hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span
                        aria-hidden
                        className="w-[9px] text-[11px] text-text-4"
                      >
                        {expanded ? "▾" : "▸"}
                      </span>
                      <CategoryDot category={row.category} size={7} />
                      {row.label}
                    </button>
                  </Td>

                  <Td numeric mono>
                    {row.amount === null ? (
                      <span className="font-sans text-text-3">нет цены</span>
                    ) : (
                      tableNumber(row.amount, amountDecimals(row.unit))
                    )}
                  </Td>

                  <Td numeric mono>
                    {dcUsd(row.amountUsd)}
                  </Td>

                  <Td numeric mono muted>
                    {row.price === null ? <Dash /> : tableUsd(row.price, usdDecimals(row.price))}
                    {row.priceStale && (
                      <span className="ml-1.5" title={STALE_PRICE_HINT}>
                        <TriangleAlert
                          aria-hidden="true"
                          className="inline size-3 text-warn"
                        />
                      </span>
                    )}
                  </Td>

                  <Td numeric>{tablePct(row.percent)}</Td>

                  <Td numeric muted>
                    {row.targetPercent === null ? (
                      <Dash />
                    ) : (
                      tablePct(row.targetPercent)
                    )}
                  </Td>

                  <Td numeric className={cn(beyond && "font-medium text-warn")}>
                    {/* Величина — процентные пункты, но единица во всём
                        интерфейсе пишется процентом (решение владельца):
                        «+3,02%» здесь значит «на 3,02 пункта выше цели» */}
                    {row.percentDiff === null ? (
                      <Dash />
                    ) : (
                      tablePctSigned(row.percentDiff)
                    )}
                  </Td>

                  <Td numeric mono muted>
                    {row.amountToBalance === null ? (
                      <Dash />
                    ) : (
                      <span title={balanceHint(row.amountToBalance, row.unit)}>
                        {tableSigned(
                          row.amountToBalance,
                          balanceDecimals(row.unit, row.amountToBalance),
                        )}
                      </span>
                    )}
                  </Td>

                  <Td numeric mono muted>
                    {row.ledger.avgPriceUsd === null ? (
                      <span title={NO_AVG_HINT}>
                        <Dash />
                      </span>
                    ) : (
                      tableUsd(
                        row.ledger.avgPriceUsd,
                        usdDecimals(row.ledger.avgPriceUsd),
                      )
                    )}
                  </Td>

                  <Td numeric>
                    {pnl === null ? (
                      <span title={NO_AVG_HINT}>
                        <Dash />
                      </span>
                    ) : (
                      <span className={cn("flex flex-col items-end gap-px", pnlClass(pnl))}>
                        <span className="font-mono">{dcUsdSigned(pnl)}</span>
                        {row.ledger.unrealizedPnlPct !== null && (
                          <span className="text-[12px] opacity-80">
                            {tablePctSigned(row.ledger.unrealizedPnlPct, 1)}
                          </span>
                        )}
                      </span>
                    )}
                  </Td>
                </Tr>

                {hasWarnings(row) && (
                  <tr className="border-line border-b">
                    <td colSpan={10} className="bg-sunken px-card py-2">
                      <RowWarnings row={row} />
                    </td>
                  </tr>
                )}

                {expanded && (
                  <tr className="border-line border-b">
                    <td colSpan={10} className="bg-sunken px-card py-3">
                      <RowDetail row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <TotalRow>
            <Td muted>Итого</Td>
            <Td />
            <Td numeric mono className="font-medium">
              {dcUsd(totalUsd)}
            </Td>
            <Td />
            <Td numeric muted>
              {tablePct(100)}
            </Td>
            <Td />
            <Td />
            <Td />
            <Td />
            <Td numeric mono className={totalPnl === null ? "" : pnlClass(totalPnl)}>
              {totalPnl === null ? <Dash /> : dcUsdSigned(totalPnl)}
            </Td>
          </TotalRow>
        </tfoot>
      </DcTable>
    </DcCard>
  );
}

/**
 * Предупреждения строки: деградация данных и мягкое расхождение
 * «леджер ↔ факт». Фон строки цветом не красится — предупреждение несёт
 * чип-подобная подпись, а не заливка (§2).
 */
function RowWarnings({ row }: { row: PortfolioRowDto }) {
  const { discrepancy } = row.ledger;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] whitespace-normal text-warn">
      {[...row.warnings, ...row.ledger.warnings].map((w) => (
        <span key={w}>{w}</span>
      ))}
      {discrepancy !== null && (
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span>
            Леджер{" "}
            <span className="font-mono">
              {tableNumber(discrepancy.ledgerQty, amountDecimals(row.unit))}
            </span>{" "}
            {row.unit}, факт{" "}
            <span className="font-mono">
              {tableNumber(discrepancy.actualQty, amountDecimals(row.unit))}
            </span>{" "}
            {row.unit} — расхождение{" "}
            <span className="font-mono">
              {tableSigned(discrepancy.diff, amountDecimals(row.unit))}
            </span>{" "}
            {row.unit}
          </span>
          <Link
            href="/trades"
            className="text-link underline-offset-4 hover:underline"
          >
            Сверить в сделках
          </Link>
        </span>
      )}
    </div>
  );
}

/** Состав категории: залог в лендинге и ручные записи. */
function RowDetail({ row }: { row: PortfolioRowDto }) {
  const empty =
    row.collateralDetail.length === 0 && row.manualEntries.length === 0;

  if (empty) {
    return (
      <p className="t-meta text-text-3">
        Пока пусто. Залог подтянется из лендинга, остальное вносится вручную
        на странице «Цели».
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {row.collateralDetail.length > 0 && (
        <div>
          <p className="t-label">
            Залог в лендинге · {dcUsd(row.breakdown.collateralUsd)}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {row.collateralDetail.map((d) => (
              <li
                key={`${d.walletId}-${d.chain}-${d.symbol}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 text-[13px]"
              >
                <span>
                  {d.symbol}
                  <span className="ml-2 text-[12px] text-text-3">
                    {chainLabel(d.chain)}
                    {d.walletLabel ? ` · ${d.walletLabel}` : ""}
                  </span>
                </span>
                <span
                  className="font-mono text-text-2"
                  title={tableQuantity(d.quantity, true)}
                >
                  {tableQuantity(d.quantity)}
                  {d.priceUsd === null ? (
                    <span className="ml-2 font-sans text-warn">нет цены</span>
                  ) : (
                    <>
                      <span className="mx-1.5 text-text-4">×</span>
                      {tableUsd(d.priceUsd, usdDecimals(d.priceUsd))}
                      <span className="mx-1.5 text-text-4">=</span>
                      <span className="font-medium text-text-1">
                        {dcUsd(d.valueUsd)}
                      </span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.manualEntries.length > 0 && (
        <div>
          <p className="t-label">
            Внесено вручную · {dcUsd(row.breakdown.manualUsd)}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {row.manualEntries.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 text-[13px]"
              >
                <span>{m.label}</span>
                <span className="font-mono text-text-2">
                  {tableQuantity(m.amount)}
                  <span className="ml-1 font-sans text-[12px]">{row.unit}</span>
                  <span className="mx-1.5 text-text-4">=</span>
                  <span className="font-medium text-text-1">
                    {dcUsd(m.valueUsd)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
