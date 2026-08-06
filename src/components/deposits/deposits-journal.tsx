"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DcCard, EmptyState } from "@/components/dc/card";
import { Chip } from "@/components/dc/chip";
import { HelpTip } from "@/components/dc/help-tip";
import { Segmented } from "@/components/dc/segmented";
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
import { Input } from "@/components/ui/input";
import type { DepositDto, DepositsResponseDto } from "@/lib/api/types";
import { dcUsd, dcUsdSigned, tableDate } from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { signedDepositAmount, type DepositDirection } from "./deposit-amount";

/**
 * Журнал «Внесено» на экране «Цели и записи» (README §8): сумма Mono 27px
 * в шапке, прибыль справа, форма на фоне --bg-sunken, ниже история строками.
 *
 * История, а не одно число: иначе нельзя ни проверить, ни исправить прошлое.
 * Сумма вводится положительной, знак ставит сегмент «Пополнение / Вывод».
 *
 * Кнопка «Записать» — secondary: единственная primary-кнопка экрана отдана
 * «Сохранить цели» (дизайн-код §5).
 */

/** Сегодня в локальном поясе для value/max нативного input type="date". */
function todayLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function DepositsJournal({
  profitUsd,
  profitLoading,
}: {
  /** Чистая − Внесено. null — долг ни разу не прочитан, прибыль неизвестна. */
  profitUsd?: number | null;
  profitLoading?: boolean;
} = {}) {
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
  const total = data?.summary.totalDeposited ?? null;

  return (
    <DcCard as="section">
      <div className="flex items-start justify-between gap-4 border-line border-b px-card pt-4 pb-3.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h2 className="t-h2">Внесено</h2>
            <HelpTip size="md">
              Только собственные деньги. Заёмные средства и прибыль от них сюда
              не попадают — прибыль считается как чистая минус внесено.
            </HelpTip>
          </div>
          {/* Главное число карточки — сумма журнала (дизайн-код §1.1) */}
          {total === null ? (
            <div aria-hidden className="h-[27px] w-[132px] rounded-pill bg-chip" />
          ) : (
            <p className="t-metric-lg">
              {dcUsd(total)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="t-label">Прибыль</span>
          {profitLoading ? (
            <span aria-hidden className="block h-4 w-[86px] rounded-pill bg-chip" />
          ) : profitUsd === null || profitUsd === undefined ? (
            <span className="text-[16px] text-text-3">—</span>
          ) : (
            <span
              className={cn(
                "font-medium text-[16px]",
                profitUsd > 0 ? "text-profit" : profitUsd < 0 ? "text-loss" : "text-text-1",
              )}
            >
              {dcUsdSigned(profitUsd)}
            </span>
          )}
        </div>
      </div>

      <form
        onSubmit={add}
        className="flex flex-col gap-3 border-line border-b bg-sunken px-card py-4"
      >
        <Segmented
          ariaLabel="Операция"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "in", label: "Пополнение" },
            { value: "out", label: "Вывод" },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            id="deposit-amount"
            type="text"
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="5000"
            aria-label="Сумма в долларах"
            className="min-w-[120px] flex-1 text-right font-mono text-base md:text-[13px]"
          />
          <Input
            id="deposit-date"
            type="date"
            required
            value={date}
            max={todayLocal()}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Дата операции"
            className="w-[152px] shrink-0 font-mono text-base md:text-[13px]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            id="deposit-note"
            type="text"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Перевод с биржи"
            aria-label="Заметка (не обязательно)"
            className="min-w-[140px] flex-1 text-base md:text-[13px]"
          />
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Сохранение…" : "Записать"}
          </Button>
        </div>

        {formError && (
          <p role="status" className="t-meta text-loss">
            {formError}
          </p>
        )}
      </form>

      {error && (
        <p role="status" className="t-meta px-card py-3 text-loss">
          Не удалось загрузить журнал: {error}
        </p>
      )}

      {loading && !data ? (
        <div className="flex flex-col gap-2 px-card py-4" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[19px] rounded-pill bg-chip" />
          ))}
        </div>
      ) : deposits.length === 0 ? (
        <EmptyState title="Записей пока нет — запишите первое пополнение" />
      ) : (
        <ul>
          {deposits.map((d) => (
            <DepositRow key={d.id} deposit={d} onRemove={remove} />
          ))}
        </ul>
      )}
    </DcCard>
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
  const kind = isWithdrawal ? "Вывод" : "Пополнение";

  return (
    <li className="flex items-center gap-3 border-line border-b px-card py-3 transition-colors duration-120 ease-out last:border-0 hover:bg-chip">
      <span className="w-[82px] shrink-0 font-mono text-[12.5px] text-text-3">
        {tableDate(deposit.happenedOn)}
      </span>
      {/* Тип операции — нейтральный чип: это не прибыль и не риск (§2) */}
      <Chip>{kind}</Chip>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-3">
        {deposit.note ?? "—"}
      </span>
      {/* Знак в тексте: вывод отличим не только чипом */}
      <span className="shrink-0 whitespace-nowrap font-mono text-[13px]">
        {dcUsdSigned(amount)}
      </span>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Удалить запись от ${tableDate(deposit.happenedOn)} на ${dcUsdSigned(amount)}`}
            className="-mr-1.5 shrink-0 text-text-4 hover:text-loss"
          >
            <X />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить запись?</AlertDialogTitle>
            <AlertDialogDescription>
              {kind} от{" "}
              <span className="font-mono">{tableDate(deposit.happenedOn)}</span>{" "}
              на <span className="font-mono">{dcUsdSigned(amount)}</span>{" "}
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
    </li>
  );
}
