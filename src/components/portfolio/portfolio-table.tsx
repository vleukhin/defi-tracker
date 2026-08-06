"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode, useState } from "react";
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
  "Сколько нужно купить или продать, чтобы вернуть долю к цели.";
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
    <>
      {/* До sm таблица разваливается в карточки. Обычно горизонтальный
          скролл здесь защищают сравнением строк между собой — но строк
          ровно три, а за краем 980-пиксельной таблицы на телефоне прятались
          «Отклон.» и «К ребаланс.», то есть ровно ответ на «что делать». */}
      <div className="flex flex-col gap-3 sm:hidden">
        {rows.map((row) => (
          <RowCard
            key={row.category}
            row={row}
            expanded={open === row.category}
            onToggle={() => setOpen(open === row.category ? null : row.category)}
          />
        ))}
        <DcCard className="bg-sunken">
          <div className="flex items-baseline justify-between gap-3 px-card py-3">
            <span className="t-label">Итого</span>
            <span className="flex items-baseline gap-3">
              {totalPnl !== null && (
                <span className={cn("font-mono text-[13px]", pnlClass(totalPnl))}>
                  {dcUsdSigned(totalPnl)}
                </span>
              )}
              <span className="font-medium font-mono text-[15px]">
                {dcUsd(totalUsd)}
              </span>
            </span>
          </div>
        </DcCard>
      </div>

      <DcCard className="max-sm:hidden">
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
                      className="flex items-center gap-2 rounded-pill text-[13.5px] outline-none transition-colors duration-120 ease-out pointer-coarse:min-h-11 hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50"
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
    </>
  );
}

/** Подпись → значение внутри карточки категории. */
function Pair({
  label,
  value,
  hint,
  tone,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5">
        <span className="t-label truncate">{label}</span>
        {hint && <HelpTip>{hint}</HelpTip>}
      </dt>
      <dd className={cn("mt-1 truncate text-[13.5px]", mono && "font-mono", tone)}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Категория карточкой — раскладка для телефона.
 *
 * Порядок сознательно не повторяет колонки таблицы: сначала количество
 * (главная метрика стратегии, docs/07 §4), затем доля против цели, и только
 * потом деньги. «К ребаланс.» вынесено отдельной строкой во всю ширину и
 * подписано действием словом: в таблице знак числа объяснял только title,
 * которого на тач-экране не существует.
 */
function RowCard({
  row,
  expanded,
  onToggle,
}: {
  row: PortfolioRowDto;
  expanded: boolean;
  onToggle: () => void;
}) {
  const beyond =
    row.percentDiff !== null &&
    Math.abs(row.percentDiff) > DEVIATION_THRESHOLD_PP;
  const pnl = row.ledger.unrealizedPnlUsd;
  const toBalance = row.amountToBalance;

  return (
    <DcCard>
      <div className="flex flex-col gap-3.5 px-card py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 font-medium text-[14px]">
            <CategoryDot category={row.category} size={7} />
            <span className="truncate">{row.label}</span>
          </span>
          <span className="shrink-0 font-mono text-[15px]">
            {dcUsd(row.amountUsd)}
          </span>
        </div>

        <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-[13px] text-text-2">
          {row.amount === null ? (
            <span className="font-sans text-text-3">нет цены</span>
          ) : (
            <span className="text-text-1">
              {tableNumber(row.amount, amountDecimals(row.unit))}
              <span className="ml-1 font-sans text-[12px] text-text-3">
                {row.unit}
              </span>
            </span>
          )}
          {row.price !== null && (
            <span className="text-text-3">
              × {tableUsd(row.price, usdDecimals(row.price))}
            </span>
          )}
          {row.priceStale && (
            <span className="inline-flex items-center gap-1 font-sans text-[12px] text-warn">
              <TriangleAlert aria-hidden="true" className="size-3" />
              {STALE_PRICE_HINT}
            </span>
          )}
        </p>

        <dl className="grid grid-cols-3 gap-x-3 gap-y-3">
          <Pair label="Доля" value={tablePct(row.percent)} />
          <Pair
            label="Цель"
            value={
              row.targetPercent === null ? <Dash /> : tablePct(row.targetPercent)
            }
          />
          <Pair
            label="Отклон."
            tone={beyond ? "font-medium text-warn" : undefined}
            value={
              row.percentDiff === null ? (
                <Dash />
              ) : (
                tablePctSigned(row.percentDiff)
              )
            }
          />
          <Pair
            label="Средняя"
            value={
              row.ledger.avgPriceUsd === null ? (
                <Dash />
              ) : (
                tableUsd(
                  row.ledger.avgPriceUsd,
                  usdDecimals(row.ledger.avgPriceUsd),
                )
              )
            }
          />
          <Pair
            label="P/L"
            tone={pnl === null ? undefined : pnlClass(pnl)}
            value={pnl === null ? <Dash /> : dcUsdSigned(pnl)}
          />
          {row.ledger.unrealizedPnlPct !== null && (
            <Pair
              label="P/L, %"
              tone={pnl === null ? undefined : pnlClass(pnl)}
              value={tablePctSigned(row.ledger.unrealizedPnlPct, 1)}
            />
          )}
        </dl>

        {toBalance !== null && toBalance !== 0 && (
          <p className="flex items-center gap-1.5 rounded-block bg-sunken px-3 py-2 text-[13px]">
            <span className="text-text-2">{balanceHint(toBalance, row.unit)}</span>
            <HelpTip>{REBALANCE_HINT}</HelpTip>
          </p>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="-mx-1 flex items-center gap-1.5 self-start rounded-control px-1 text-[12.5px] text-link outline-none pointer-coarse:min-h-11 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span aria-hidden className="text-[11px]">
            {expanded ? "▾" : "▸"}
          </span>
          Состав категории
        </button>
      </div>

      {hasWarnings(row) && (
        <div className="border-line border-t bg-sunken px-card py-2">
          <RowWarnings row={row} />
        </div>
      )}

      {expanded && (
        <div className="border-line border-t bg-sunken px-card py-3">
          <RowDetail row={row} />
        </div>
      )}
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

/** Состав категории: залог в лендинге, свободные средства и ручные записи. */
function RowDetail({ row }: { row: PortfolioRowDto }) {
  const empty =
    row.collateralDetail.length === 0 &&
    row.manualEntries.length === 0 &&
    row.freeBalances.length === 0;

  if (empty) {
    return (
      <p className="t-meta text-text-3">
        Пока пусто. Залог и свободные монеты подтянутся с кошельков, остальное
        вносится вручную на странице «Цели».
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

      {row.freeBalances.length > 0 && (
        <div>
          <p className="t-label">
            Свободно на кошельках · {dcUsd(row.breakdown.freeUsd)}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {row.freeBalances.map((b) => (
              <li
                key={b.key}
                className="flex flex-wrap items-baseline justify-between gap-x-4 text-[13px]"
              >
                <span>
                  {b.symbol}
                  <span className="ml-2 text-[12px] text-text-3">
                    {chainLabel(b.chain)}
                    {b.walletLabel ? ` · ${b.walletLabel}` : ""}
                  </span>
                  {/* Заёмные видно, но в сумму категории они не вошли —
                      без пометки строка выглядела бы ошибкой сложения */}
                  {!b.countedInCategory && (
                    <span className="ml-2 text-[12px] text-text-3">
                      заёмные, вне категории
                    </span>
                  )}
                </span>
                <span
                  className="font-mono text-text-2"
                  title={tableQuantity(b.quantity, true)}
                >
                  {tableQuantity(b.quantity)}
                  {b.priceUsd === null ? (
                    <span className="ml-2 font-sans text-warn">нет цены</span>
                  ) : (
                    <>
                      <span className="mx-1.5 text-text-4">×</span>
                      {tableUsd(b.priceUsd, usdDecimals(b.priceUsd))}
                      <span className="mx-1.5 text-text-4">=</span>
                      <span
                        className={
                          b.countedInCategory
                            ? "font-medium text-text-1"
                            : "text-text-3"
                        }
                      >
                        {dcUsd(b.valueUsd)}
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
