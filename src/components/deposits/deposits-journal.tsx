"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DepositDto, DepositsResponseDto } from "@/lib/api/types";
import {
  MINUS,
  NBSP,
  tableDate,
  tableUsd,
  tableUsdSigned,
  usdDecimals,
} from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import {
  signedDepositAmount,
  type DepositDirection,
} from "./deposit-amount";

/**
 * Журнал «Внесено» (Фаза 4, S4.0) на экране «Цели и записи» — рядом со
 * вторым журналом ручного ввода. История, а не одно число: иначе нельзя
 * ни проверить, ни исправить прошлое.
 *
 * Сумма вводится положительной, знак ставит переключатель
 * «Пополнение / Вывод». Итог журнала — подписанная сумма всех записей.
 */

/** Сегмент радио-контрола — как в форме сделок (trade-form.tsx). */
const SEGMENT =
  "flex h-9 cursor-pointer select-none items-center justify-center gap-2 rounded-md border border-input px-2 text-sm transition-colors duration-120 ease-out hover:bg-accent/60 has-checked:border-ring has-checked:bg-accent has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

/** Сегодня в локальном поясе для value/max нативного input type="date". */
function todayLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function DepositsJournal() {
  const { data, error, loading, refetch } =
    useApi<DepositsResponseDto>("/api/deposits");

  const [direction, setDirection] = useState<DepositDirection>("in");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const signed = signedDepositAmount(direction, amount);
    if (signed === null) {
      setFormError("Сумма должна быть положительным числом");
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      await apiFetch("/api/deposits", {
        method: "POST",
        body: JSON.stringify({
          amount: signed,
          happenedOn: date,
          note: note.trim() === "" ? null : note.trim(),
        }),
      });
      toast.success(
        direction === "in" ? "Пополнение записано" : "Вывод записан",
      );
      setAmount("");
      setNote("");
      setDate(todayLocal());
      setDirection("in");
      await refetch();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Не удалось сохранить запись",
      );
    } finally {
      setPending(false);
    }
  }

  async function remove(deposit: DepositDto) {
    try {
      await apiFetch(`/api/deposits/${deposit.id}`, { method: "DELETE" });
      toast.success("Запись удалена");
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Не удалось удалить запись",
      );
    }
  }

  const deposits = data?.deposits ?? [];
  const total = data?.summary.totalDeposited ?? 0;

  return (
    <Card className="p-0">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Внесено</h2>
          {data !== null && deposits.length > 0 && (
            <span
              className="font-mono text-sm text-muted-foreground"
              title="Подписанная сумма журнала: выводы уменьшают итог"
            >
              {tableUsd(total, usdDecimals(total))}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Только собственные деньги. Заемные средства и прибыль от них сюда не
          попадают — прибыль считается как Чистая{NBSP}
          {MINUS}
          {NBSP}Внесено.
        </p>
      </div>

      <form onSubmit={add} className="space-y-3 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset>
            <legend className="text-sm font-medium">Операция</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <label className={cn(SEGMENT, "has-checked:text-success")}>
                <input
                  type="radio"
                  name="deposit-direction"
                  value="in"
                  checked={direction === "in"}
                  onChange={() => setDirection("in")}
                  className="sr-only"
                />
                Пополнение
              </label>
              <label className={cn(SEGMENT, "has-checked:text-destructive")}>
                <input
                  type="radio"
                  name="deposit-direction"
                  value="out"
                  checked={direction === "out"}
                  onChange={() => setDirection("out")}
                  className="sr-only"
                />
                Вывод
              </label>
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="deposit-amount">Сумма, $</Label>
            <Input
              id="deposit-amount"
              type="text"
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="5000"
              className="text-right font-mono"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="deposit-date">Дата</Label>
            <Input
              id="deposit-date"
              type="date"
              required
              value={date}
              max={todayLocal()}
              onChange={(e) => setDate(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deposit-note">Заметка (не обяз.)</Label>
            <Input
              id="deposit-note"
              type="text"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Перевод с биржи"
            />
          </div>
        </div>

        {formError && (
          <p role="status" className="text-sm text-destructive">
            {formError}
          </p>
        )}

        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Сохранение…" : "Добавить"}
        </Button>
      </form>

      {error && (
        <p className="px-4 pb-2 text-sm text-destructive" role="status">
          Не удалось загрузить журнал: {error}
        </p>
      )}

      {loading && !data ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">Загрузка…</p>
      ) : deposits.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          Записей пока нет.
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {deposits.map((d) => (
            <DepositRow key={d.id} deposit={d} onRemove={remove} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function DepositRow({
  deposit,
  onRemove,
}: {
  deposit: DepositDto;
  onRemove: (deposit: DepositDto) => void;
}) {
  const amount = Number.parseFloat(deposit.amount);
  const isWithdrawal = amount < 0;

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="flex min-w-0 items-baseline gap-3">
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {tableDate(deposit.happenedOn)}
        </span>
        <span className="min-w-0 truncate text-sm">
          {deposit.note ?? (
            <span className="text-muted-foreground">
              {isWithdrawal ? "Вывод" : "Пополнение"}
            </span>
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {/* Знак в тексте: вывод отличим не только словом в заметке */}
        <span className="font-mono text-sm whitespace-nowrap">
          {tableUsdSigned(amount, usdDecimals(amount))}
        </span>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Удалить запись от ${tableDate(deposit.happenedOn)} на ${tableUsdSigned(amount, usdDecimals(amount))}`}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="size-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить запись?</AlertDialogTitle>
              <AlertDialogDescription>
                {isWithdrawal ? "Вывод" : "Пополнение"} от{" "}
                <span className="font-mono">
                  {tableDate(deposit.happenedOn)}
                </span>{" "}
                на{" "}
                <span className="font-mono">
                  {tableUsdSigned(amount, usdDecimals(amount))}
                </span>{" "}
                исчезнет из журнала, итог «Внесено» пересчитается.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void onRemove(deposit)}
              >
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </span>
    </li>
  );
}
