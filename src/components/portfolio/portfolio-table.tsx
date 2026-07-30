"use client";

import { ChevronRight, TriangleAlert } from "lucide-react";
import { Fragment, useState } from "react";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PortfolioRowDto } from "@/lib/api/types";
import {
  DEVIATION_THRESHOLD_PP,
  chainLabel,
  tableNumber,
  tableQuantity,
  tablePct,
  tablePctSigned,
  tableSigned,
  tableUsd,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { CATEGORY_VAR, CategoryDot } from "./category";

/**
 * Таблица портфеля в виде рабочей таблицы пользователя (S1.7):
 * сетка с границами ячеек, числа выровнены по правому краю, десятичная
 * запятая, фиксированная точность с сохранением нулей, итог — в колонке
 * стоимости. Столбцы 1:1 повторяют исходную таблицу:
 * Количество · Стоимость USD · Цена · Доля · Цель · Отклонение · К ребалансировке.
 *
 * Отделка — «Terminal Blue» (ТЗ §5.1.6): структура не меняется, зебры нет
 * (сетка границ уже структурирует), числа — JetBrains Mono.
 *
 * На узких экранах (< md) сетка заменяется стеком карточек: таблица из
 * восьми колонок на 375 px нечитаема.
 */

/** Знаков в количестве: у стейблов дробная часть не нужна. */
function amountDecimals(unit: string): number {
  return unit === "USD" ? 0 : 4;
}

/**
 * Точность количества к ребалансировке подстраивается под масштаб:
 * −0,071486 BTC нужно видеть целиком, а у −3 732,86 ETH шесть знаков
 * только ломают верстку.
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

/** Отклонение за порогом — warning; направление уже кодируется знаком. */
function deviationClass(diff: number): string {
  return Math.abs(diff) > DEVIATION_THRESHOLD_PP
    ? "font-medium text-warning"
    : "";
}

/** «К ребалансировке»: плюс — купить (success), минус — продать (destructive). */
function balanceClass(value: number): string {
  if (value > 0) return "text-success";
  if (value < 0) return "text-destructive";
  return "";
}

const COLUMNS = [
  "Количество",
  "Стоимость USD",
  "Цена",
  "Доля",
  "Цель",
  "Отклонение",
  "К ребалансировке",
];

/** Общие классы ячейки: границы сетки + числа mono по правому краю. */
const CELL = "border border-border px-3 py-2 text-right font-mono text-sm";
const HEAD =
  "h-auto border border-border bg-muted/60 px-3 py-2 text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground";

export function PortfolioTable({
  rows,
  totalUsd,
}: {
  rows: PortfolioRowDto[];
  totalUsd: number;
}) {
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  return (
    <>
      {/* Табличный вид — от md и шире */}
      <Card className="hidden overflow-hidden p-0 md:block">
        <Table className="border-collapse">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {/* Угловая ячейка пустая — как в исходной таблице */}
              <TableHead className={`${HEAD} text-left`} />
              {COLUMNS.map((c) => (
                <TableHead key={c} className={`${HEAD} text-right`} scope="col">
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const open = openCategory === row.category;
              const detailCount =
                row.collateralDetail.length + row.manualEntries.length;
              return (
                <Fragment key={row.category}>
                  <TableRow className="transition-colors duration-120 hover:bg-accent/50">
                    <th
                      scope="row"
                      className="border border-border px-3 py-2 text-left font-normal"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenCategory(open ? null : row.category)
                        }
                        aria-expanded={open}
                        className="flex items-center gap-1.5 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        title={
                          detailCount > 0
                            ? "Показать состав"
                            : "Состав пока пуст"
                        }
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className={cn(
                            "size-3.5 text-muted-foreground transition-transform duration-150",
                            open && "rotate-90",
                          )}
                        />
                        <CategoryDot category={row.category} />
                        {row.label}
                      </button>
                    </th>

                    <TableCell className={CELL}>
                      {row.amount === null ? (
                        <span className="font-sans text-muted-foreground">
                          нет цены
                        </span>
                      ) : (
                        tableNumber(row.amount, amountDecimals(row.unit))
                      )}
                    </TableCell>

                    <TableCell className={CELL}>
                      {tableUsd(row.amountUsd)}
                    </TableCell>

                    <TableCell className={CELL}>
                      {row.price === null ? "—" : tableUsd(row.price)}
                      {row.priceStale && (
                        // Существующая подсказка сохраняется (ТЗ §6.2)
                        <span
                          className="ml-1"
                          title="Цена устарела: не удалось обновить"
                        >
                          <TriangleAlert
                            aria-hidden="true"
                            className="inline size-3 text-warning"
                          />
                        </span>
                      )}
                    </TableCell>

                    <TableCell className={CELL}>
                      {tablePct(row.percent)}
                    </TableCell>

                    <TableCell className={CELL}>
                      {row.targetPercent === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        tablePct(row.targetPercent)
                      )}
                    </TableCell>

                    <TableCell
                      className={`${CELL} ${
                        row.percentDiff === null
                          ? ""
                          : deviationClass(row.percentDiff)
                      }`}
                    >
                      {row.percentDiff === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        tablePctSigned(row.percentDiff)
                      )}
                    </TableCell>

                    <TableCell
                      className={`${CELL} ${
                        row.amountToBalance === null
                          ? ""
                          : balanceClass(row.amountToBalance)
                      }`}
                    >
                      {row.amountToBalance === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span title={balanceHint(row.amountToBalance, row.unit)}>
                          {tableSigned(
                            row.amountToBalance,
                            balanceDecimals(row.unit, row.amountToBalance),
                          )}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>

                  {row.warnings.length > 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={COLUMNS.length + 1}
                        className="border border-border bg-warning/10 px-3 py-1.5 text-xs text-warning"
                      >
                        {row.warnings.map((w) => (
                          <span
                            key={w}
                            className="mr-3 inline-flex items-center gap-1"
                          >
                            <TriangleAlert
                              aria-hidden="true"
                              className="size-3.5 shrink-0"
                            />
                            {w}
                          </span>
                        ))}
                      </TableCell>
                    </TableRow>
                  )}

                  {open && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={COLUMNS.length + 1}
                        className="border border-border bg-muted/40 px-3 py-2"
                        style={{
                          boxShadow: `inset 2px 0 0 ${CATEGORY_VAR[row.category]}`,
                        }}
                      >
                        <RowDetail row={row} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}

            {/* Итог — в колонке стоимости, как в исходной таблице */}
            <TableRow className="hover:bg-transparent">
              <th scope="row" className={`${HEAD} text-left`} />
              <TableCell className={`${CELL} bg-muted/60`} />
              <TableCell className={`${CELL} bg-muted/60 font-semibold`}>
                {tableUsd(totalUsd)}
              </TableCell>
              <TableCell className={`${CELL} bg-muted/60`} colSpan={5} />
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      {/* Мобильный вид: восемь колонок на 375 px нечитаемы */}
      <Card className="p-0 md:hidden">
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <MobileCard
              key={row.category}
              row={row}
              open={openCategory === row.category}
              onToggle={() =>
                setOpenCategory(
                  openCategory === row.category ? null : row.category,
                )
              }
            />
          ))}
          <li className="flex items-baseline justify-between rounded-b-xl bg-muted/60 px-4 py-2.5">
            <span className="text-sm text-muted-foreground">Итого</span>
            <span className="font-mono text-base font-semibold">
              {tableUsd(totalUsd)}
            </span>
          </li>
        </ul>
      </Card>
    </>
  );
}

function MobileCard({
  row,
  open,
  onToggle,
}: {
  row: PortfolioRowDto;
  open: boolean;
  onToggle: () => void;
}) {
  const pairs: [string, React.ReactNode][] = [
    [
      "Количество",
      row.amount === null ? (
        <span className="font-sans text-muted-foreground">нет цены</span>
      ) : (
        tableNumber(row.amount, amountDecimals(row.unit))
      ),
    ],
    ["Стоимость USD", tableUsd(row.amountUsd)],
    [
      "Цена",
      row.price === null ? (
        "—"
      ) : (
        <>
          {tableUsd(row.price)}
          {row.priceStale && (
            <span className="ml-1" title="Цена устарела: не удалось обновить">
              <TriangleAlert
                aria-hidden="true"
                className="inline size-3 text-warning"
              />
            </span>
          )}
        </>
      ),
    ],
    ["Доля", tablePct(row.percent)],
    ["Цель", row.targetPercent === null ? "—" : tablePct(row.targetPercent)],
    [
      "Отклонение",
      row.percentDiff === null ? (
        "—"
      ) : (
        <span className={deviationClass(row.percentDiff)}>
          {tablePctSigned(row.percentDiff)}
        </span>
      ),
    ],
    [
      "К ребалансировке",
      row.amountToBalance === null ? (
        "—"
      ) : (
        <span className={balanceClass(row.amountToBalance)}>
          {tableSigned(
            row.amountToBalance,
            balanceDecimals(row.unit, row.amountToBalance),
          )}
        </span>
      ),
    ],
  ];

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full px-4 py-3 text-left outline-none transition-colors duration-120 active:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-1.5">
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
              open && "rotate-90",
            )}
          />
          <CategoryDot category={row.category} />
          <span className="text-sm font-medium">{row.label}</span>
          <span className="ml-auto font-mono text-sm font-semibold">
            {tableUsd(row.amountUsd)}
          </span>
        </span>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {pairs.slice(0, 1).concat(pairs.slice(2)).map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground">
                {label}
              </dt>
              <dd className="font-mono text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </button>

      {row.warnings.length > 0 && (
        <ul className="bg-warning/10 px-4 py-1.5 text-xs text-warning">
          {row.warnings.map((w) => (
            <li key={w} className="flex items-center gap-1">
              <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div
          className="bg-muted/40 px-4 py-2"
          style={{
            boxShadow: `inset 2px 0 0 ${CATEGORY_VAR[row.category]}`,
          }}
        >
          <RowDetail row={row} />
        </div>
      )}
    </li>
  );
}

/** Состав категории: залог по сетям и ручные записи. */
function RowDetail({ row }: { row: PortfolioRowDto }) {
  const empty =
    row.collateralDetail.length === 0 && row.manualEntries.length === 0;

  if (empty) {
    return (
      <p className="text-xs text-muted-foreground">
        Пока пусто. Залог подтянется из лендинга, остальное вносится вручную на
        странице «Цели и записи».
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {row.collateralDetail.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Залог в лендинге ·{" "}
            <span className="font-mono">
              {tableUsd(row.breakdown.collateralUsd)}
            </span>
          </p>
          <ul className="mt-0.5 divide-y divide-border text-sm">
            {row.collateralDetail.map((d) => (
              <li
                key={`${d.walletId}-${d.chain}-${d.symbol}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 py-1"
              >
                <span>
                  {d.symbol}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {chainLabel(d.chain)}
                    {d.walletLabel ? ` · ${d.walletLabel}` : ""}
                  </span>
                </span>
                <span
                  className="font-mono text-muted-foreground"
                  title={tableQuantity(d.quantity, true)}
                >
                  {tableQuantity(d.quantity)}
                  {d.priceUsd === null ? (
                    <span className="ml-1.5 font-sans text-warning">
                      нет цены
                    </span>
                  ) : (
                    <>
                      <span className="mx-1.5">×</span>
                      {tableUsd(d.priceUsd)}
                      <span className="mx-1.5">=</span>
                      <span className="font-medium text-foreground">
                        {tableUsd(d.valueUsd)}
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
          <p className="text-xs font-medium text-muted-foreground">
            Внесено вручную ·{" "}
            <span className="font-mono">
              {tableUsd(row.breakdown.manualUsd)}
            </span>
          </p>
          <ul className="mt-0.5 divide-y divide-border text-sm">
            {row.manualEntries.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 py-1"
              >
                <span>{m.label}</span>
                <span className="font-mono text-muted-foreground">
                  {tableQuantity(m.amount)}
                  <span className="ml-1 font-sans text-xs">{row.unit}</span>
                  <span className="mx-1.5">=</span>
                  <span className="font-medium text-foreground">
                    {tableUsd(m.valueUsd)}
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
