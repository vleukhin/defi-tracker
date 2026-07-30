"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CategoryDot } from "@/components/portfolio/category";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TradeDto } from "@/lib/api/types";
import {
  tableDate,
  tableQuantity,
  tableUsd,
  usdDecimals,
} from "@/lib/format";
import { ApiError, apiFetch } from "@/lib/use-api";
import { CATEGORY_LABEL, CATEGORY_UNIT } from "./categories";

/**
 * Список сделок (S2.1): spreadsheet-таблица на md+ (стиль таблицы портфеля,
 * §5.1.6), стек карточек на мобильных. Сумма (кол-во × цена) — расчет для
 * отображения; редактирование — формой сверху, удаление — через AlertDialog
 * с напоминанием о пересчете средней и P/L.
 */

/** Общие классы ячеек — как в таблице портфеля (§5.1.6). */
const CELL = "border border-border px-3 py-2 text-right font-mono text-sm";
const HEAD =
  "h-auto border border-border bg-muted/60 px-3 py-2 text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground";

/** Числовое значение из десятичной строки; мусор → null. */
function num(raw: string): number | null {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/** Сумма сделки (кол-во × цена) для отображения. */
function tradeTotal(trade: TradeDto): number | null {
  const q = num(trade.quantity);
  const p = num(trade.priceUsd);
  return q !== null && p !== null ? q * p : null;
}

function SideBadge({ side }: { side: TradeDto["side"] }) {
  return side === "buy" ? (
    <Badge variant="success">Покупка</Badge>
  ) : (
    <Badge variant="destructive">Продажа</Badge>
  );
}

function DeleteTradeDialog({
  trade,
  onDeleted,
}: {
  trade: TradeDto;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiFetch(`/api/trades/${trade.id}`, { method: "DELETE" });
      toast.success("Сделка удалена");
      onDeleted();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Не удалось удалить сделку",
      );
      setDeleting(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={deleting}
          aria-label={`Удалить сделку от ${tableDate(trade.tradedAt)}`}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить сделку?</AlertDialogTitle>
          <AlertDialogDescription>
            Средняя цена и P/L будут пересчитаны.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void handleDelete()}
          >
            Удалить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EditButton({
  trade,
  onEdit,
}: {
  trade: TradeDto;
  onEdit: (trade: TradeDto) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={() => onEdit(trade)}
      aria-label={`Изменить сделку от ${tableDate(trade.tradedAt)}`}
      className="text-muted-foreground hover:text-foreground"
    >
      <Pencil className="size-4" />
    </Button>
  );
}

/** Заметка с усечением; полный текст — в тултипе (§4.2). */
function NoteCell({ note }: { note: string | null }) {
  if (!note) return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block max-w-36 truncate" tabIndex={0}>
          {note}
        </span>
      </TooltipTrigger>
      <TooltipContent>{note}</TooltipContent>
    </Tooltip>
  );
}

const COLUMNS: { label: string; align: "left" | "right" }[] = [
  { label: "Дата", align: "left" },
  { label: "Категория", align: "left" },
  { label: "Сторона", align: "left" },
  { label: "Количество", align: "right" },
  { label: "Цена", align: "right" },
  { label: "Сумма", align: "right" },
  { label: "Комиссия", align: "right" },
  { label: "Заметка", align: "left" },
];

export function TradesList({
  trades,
  onEdit,
  onDeleted,
}: {
  trades: TradeDto[];
  onEdit: (trade: TradeDto) => void;
  onDeleted: () => void;
}) {
  return (
    <TooltipProvider>
      {/* Табличный вид — от md и шире; при нехватке ширины скролл внутри Card */}
      <Card className="hidden overflow-hidden p-0 md:block">
        <Table className="border-collapse">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((c) => (
                <TableHead
                  key={c.label}
                  scope="col"
                  className={`${HEAD} ${c.align === "left" ? "text-left" : "text-right"}`}
                >
                  {c.label}
                </TableHead>
              ))}
              {/* Колонка действий — без заголовка */}
              <TableHead className={HEAD}>
                <span className="sr-only">Действия</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((trade) => {
              const price = num(trade.priceUsd);
              const feeNum = trade.feeUsd === null ? null : num(trade.feeUsd);
              const total = tradeTotal(trade);
              return (
                <TableRow
                  key={trade.id}
                  className="transition-colors duration-120 hover:bg-accent/50"
                >
                  <TableCell className={`${CELL} text-left`}>
                    {tableDate(trade.tradedAt)}
                  </TableCell>
                  <TableCell className="border border-border px-3 py-2 text-sm">
                    <span className="flex items-center gap-1.5">
                      <CategoryDot category={trade.category} />
                      {CATEGORY_LABEL[trade.category]}
                    </span>
                  </TableCell>
                  <TableCell className="border border-border px-3 py-2">
                    <SideBadge side={trade.side} />
                  </TableCell>
                  <TableCell className={CELL}>
                    {tableQuantity(trade.quantity)}
                    <span className="ml-1 font-sans text-xs text-muted-foreground">
                      {CATEGORY_UNIT[trade.category]}
                    </span>
                  </TableCell>
                  <TableCell className={CELL}>
                    {price === null ? "—" : tableUsd(price, usdDecimals(price))}
                  </TableCell>
                  <TableCell className={CELL}>
                    {total === null ? "—" : tableUsd(total, usdDecimals(total))}
                  </TableCell>
                  <TableCell className={CELL}>
                    {feeNum === null || feeNum === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      tableUsd(feeNum, 2)
                    )}
                  </TableCell>
                  <TableCell className="border border-border px-3 py-2 text-sm">
                    <NoteCell note={trade.note} />
                  </TableCell>
                  <TableCell className="border border-border px-2 py-2">
                    <span className="flex items-center justify-end gap-1">
                      <EditButton trade={trade} onEdit={onEdit} />
                      <DeleteTradeDialog trade={trade} onDeleted={onDeleted} />
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Мобильный вид: девять колонок на 375 px нечитаемы — стек карточек */}
      <Card className="p-0 md:hidden">
        <ul className="divide-y divide-border">
          {trades.map((trade) => (
            <MobileTradeCard
              key={trade.id}
              trade={trade}
              onEdit={onEdit}
              onDeleted={onDeleted}
            />
          ))}
        </ul>
      </Card>
    </TooltipProvider>
  );
}

function MobileTradeCard({
  trade,
  onEdit,
  onDeleted,
}: {
  trade: TradeDto;
  onEdit: (trade: TradeDto) => void;
  onDeleted: () => void;
}) {
  const price = num(trade.priceUsd);
  const feeNum = trade.feeUsd === null ? null : num(trade.feeUsd);
  const total = tradeTotal(trade);

  const pairs: [string, React.ReactNode][] = [
    [
      "Количество",
      <>
        {tableQuantity(trade.quantity)}
        <span className="ml-1 font-sans text-xs text-muted-foreground">
          {CATEGORY_UNIT[trade.category]}
        </span>
      </>,
    ],
    ["Цена", price === null ? "—" : tableUsd(price, usdDecimals(price))],
  ];
  if (feeNum !== null && feeNum !== 0) {
    pairs.push(["Комиссия", tableUsd(feeNum, 2)]);
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-2">
        <CategoryDot category={trade.category} />
        <span className="text-sm font-medium">
          {CATEGORY_LABEL[trade.category]}
        </span>
        <SideBadge side={trade.side} />
        <span className="ml-auto font-mono text-sm font-semibold">
          {total === null ? "—" : tableUsd(total, usdDecimals(total))}
        </span>
      </div>
      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
        {tableDate(trade.tradedAt)}
      </p>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {pairs.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground">
              {label}
            </dt>
            <dd className="font-mono text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      {trade.note && (
        <p className="mt-1.5 truncate text-xs text-muted-foreground" title={trade.note}>
          {trade.note}
        </p>
      )}

      <div className="mt-2 flex items-center gap-1">
        <EditButton trade={trade} onEdit={onEdit} />
        <DeleteTradeDialog trade={trade} onDeleted={onDeleted} />
      </div>
    </li>
  );
}
