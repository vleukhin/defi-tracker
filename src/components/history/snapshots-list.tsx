"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { CATEGORY_VAR, CategoryDot } from "@/components/portfolio/category";
import {
  CATEGORY_LABEL,
  CATEGORY_UNIT,
  TRADE_CATEGORIES,
} from "@/components/trades/categories";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SnapshotDto, SnapshotItemDto } from "@/lib/api/types";
import {
  tableDate,
  tableNumber,
  tablePct,
  tableUsd,
  usdDecimals,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Список снепшотов с проваливанием в полный состав на дату (S3.2).
 * Раскрытие — как в таблице портфеля (§5.1.6): кнопка с aria-expanded
 * в первой ячейке, состав в строке под ней.
 *
 * Спред «нет данных»: количество и цена приходят null (а не нулем), когда
 * цены на момент съема не было, — показываем это словами, не «0».
 */

const CELL = "border border-border px-2 py-2 text-right font-mono text-sm";
const HEAD =
  "h-auto border border-border bg-muted/60 px-2 py-2 text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground";
const DT =
  "text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground";

/** Порядок состава фиксирован — как в таблице портфеля. */
function orderedItems(snapshot: SnapshotDto): SnapshotItemDto[] {
  return TRADE_CATEGORIES.map(
    (c) =>
      snapshot.items.find((i) => i.category === c.key) ?? {
        category: c.key,
        quantity: null,
        priceUsd: null,
        valueUsd: 0,
        percent: 0,
        collateralUsd: 0,
        manualUsd: 0,
      },
  );
}

function NoData({ title }: { title: string }) {
  return (
    <span className="font-sans text-muted-foreground" title={title}>
      нет данных
    </span>
  );
}

function PartialBadge() {
  return (
    <Badge
      variant="warning"
      title="Данные на эту дату неполные: не прочиталась сеть или не было цены"
    >
      частичный
    </Badge>
  );
}

/** Знаков в количестве: у стейблов дробная часть не нужна. */
function amountDecimals(unit: string): number {
  return unit === "USD" ? 0 : 4;
}

export function SnapshotsList({ snapshots }: { snapshots: SnapshotDto[] }) {
  // Новые сверху: список читается «что было вчера», в отличие от графика
  const rows = [...snapshots].reverse();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold">Снепшоты</h2>

      {/* Табличный вид — от md и шире */}
      <Card className="hidden overflow-hidden p-0 md:block">
        <Table className="border-collapse">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={`${HEAD} text-left`} scope="col">
                Дата
              </TableHead>
              <TableHead className={`${HEAD} text-right`} scope="col">
                Итог
              </TableHead>
              {TRADE_CATEGORIES.map((c) => (
                <TableHead
                  key={c.key}
                  className={`${HEAD} text-right`}
                  scope="col"
                >
                  {c.label}
                </TableHead>
              ))}
              <TableHead className={HEAD}>
                <span className="sr-only">Признаки</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((snapshot) => {
              const open = openId === snapshot.id;
              const items = orderedItems(snapshot);
              return (
                <Fragment key={snapshot.id}>
                  <TableRow className="transition-colors duration-120 hover:bg-accent/50">
                    <th
                      scope="row"
                      className="border border-border px-2 py-2 text-left font-normal"
                    >
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : snapshot.id)}
                        aria-expanded={open}
                        title="Показать состав на дату"
                        className="flex items-center gap-1.5 rounded-sm font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className={cn(
                            "size-3.5 text-muted-foreground transition-transform duration-150",
                            open && "rotate-90",
                          )}
                        />
                        {tableDate(snapshot.takenOn)}
                      </button>
                    </th>
                    <TableCell className={`${CELL} font-medium`}>
                      {tableUsd(snapshot.totalUsd)}
                    </TableCell>
                    {items.map((item) => (
                      <TableCell key={item.category} className={CELL}>
                        {tablePct(item.percent)}
                      </TableCell>
                    ))}
                    <TableCell className="border border-border px-2 py-2 text-right">
                      {snapshot.isPartial && <PartialBadge />}
                    </TableCell>
                  </TableRow>

                  {open && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={6}
                        className="border border-border bg-muted/40 px-3 py-2"
                      >
                        <SnapshotDetail snapshot={snapshot} items={items} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Мобильный вид: шесть колонок на 375 px нечитаемы — стек карточек */}
      <Card className="p-0 md:hidden">
        <ul className="divide-y divide-border">
          {rows.map((snapshot) => {
            const open = openId === snapshot.id;
            const items = orderedItems(snapshot);
            return (
              <li key={snapshot.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : snapshot.id)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left outline-none transition-colors duration-120 focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-accent/50"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                      open && "rotate-90",
                    )}
                  />
                  <span className="font-mono text-sm">
                    {tableDate(snapshot.takenOn)}
                  </span>
                  {snapshot.isPartial && <PartialBadge />}
                  <span className="ml-auto font-mono text-sm font-semibold">
                    {tableUsd(snapshot.totalUsd)}
                  </span>
                </button>

                <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3">
                  {items.map((item) => (
                    <span
                      key={item.category}
                      className="inline-flex items-center gap-1.5"
                    >
                      <CategoryDot category={item.category} />
                      <span className="font-mono text-xs text-muted-foreground">
                        {tablePct(item.percent)}
                      </span>
                    </span>
                  ))}
                </div>

                {open && (
                  <div className="bg-muted/40 px-4 py-3">
                    <SnapshotDetail snapshot={snapshot} items={items} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

/** Полный состав портфеля на дату: количество, цена, стоимость, доля, разбивка. */
function SnapshotDetail({
  snapshot,
  items,
}: {
  snapshot: SnapshotDto;
  items: SnapshotItemDto[];
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Состав на <span className="font-mono">{tableDate(snapshot.takenOn)}</span>
        {" · "}снят{" "}
        <span className="font-mono">
          {new Date(snapshot.takenAt).toISOString().slice(11, 16)} UTC
        </span>
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        {items.map((item) => {
          const unit = CATEGORY_UNIT[item.category];
          return (
            <div
              key={item.category}
              className="rounded-md border border-border bg-card p-3"
              style={{
                boxShadow: `inset 2px 0 0 ${CATEGORY_VAR[item.category]}`,
              }}
            >
              <div className="flex items-baseline gap-2">
                <CategoryDot category={item.category} />
                <span className="text-sm font-medium">
                  {CATEGORY_LABEL[item.category]}
                </span>
                <span className="ml-auto font-mono text-sm font-semibold">
                  {tableUsd(item.valueUsd)}
                </span>
              </div>

              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                <div>
                  <dt className={DT}>Количество</dt>
                  <dd className="font-mono text-sm">
                    {item.quantity === null ? (
                      <NoData title="цены на момент съема не было — количество не выводится" />
                    ) : (
                      <>
                        {tableNumber(item.quantity, amountDecimals(unit))}
                        <span className="ml-1 font-sans text-xs text-muted-foreground">
                          {unit}
                        </span>
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className={DT}>Цена</dt>
                  <dd className="font-mono text-sm">
                    {item.priceUsd === null ? (
                      <NoData title="цены на момент съема не было" />
                    ) : (
                      tableUsd(item.priceUsd, usdDecimals(item.priceUsd))
                    )}
                  </dd>
                </div>
                <div>
                  <dt className={DT}>Доля</dt>
                  <dd className="font-mono text-sm">{tablePct(item.percent)}</dd>
                </div>
                <div>
                  <dt className={DT}>Залог / вручную</dt>
                  <dd className="font-mono text-sm">
                    {tableUsd(item.collateralUsd)}
                    <span className="mx-1 font-sans text-muted-foreground">
                      /
                    </span>
                    {tableUsd(item.manualUsd)}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}
