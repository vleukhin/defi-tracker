"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DcCard } from "@/components/dc/card";
import { HelpTip } from "@/components/dc/help-tip";
import { Segmented } from "@/components/dc/segmented";
import { CategoryDot } from "@/components/portfolio/category";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  PortfolioCategory,
  TradeDto,
  TradeResponseDto,
} from "@/lib/api/types";
import { ApiError, apiFetch } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { CATEGORY_LABEL, CATEGORY_UNIT, TRADE_CATEGORIES } from "./categories";
import { DeleteTradeDialog } from "./delete-trade-dialog";

/**
 * Форма сделки: категория, сторона, количество, «цена за единицу ИЛИ сумма
 * всего» (второе выводится из количества автоматически), дата (не в будущем),
 * опциональная заметка.
 *
 * Форма не висит в потоке, а раскрывается по кнопке «Новая сделка» и
 * закрывается по «✕»/«Отмена» (дизайн-код §8, чек-лист). Раскрытием и
 * монтированием управляет TradesManager — здесь только содержимое.
 *
 * Одна форма на добавление и редактирование: «правка» в таблице передаёт
 * trade — родитель перемонтирует форму через key, инициализаторы useState
 * подхватывают значения. Отправляется всегда priceUsd — производная от
 * суммы, если пользователь заполнял сумму.
 */

/** Десятичная строка инпута в число; запятая толерантна, как в API. */
function parseDecimal(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number.parseFloat(raw.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Число обратно в инпут: без экспоненты, хвостовые нули срезаны. */
function toInput(n: number): string {
  if (!Number.isFinite(n)) return "";
  return n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

/** Сегодня в локальном поясе для value/max нативного input type="date". */
function todayLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Путь zod из issue убираем: сообщения уже называют поле по-русски. */
function humanIssue(issue: string): string {
  return issue.replace(/^[a-zA-Z.]+: /, "");
}

/** Поле формы: подпись --type-label, при необходимости «?» рядом. */
function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-[7px]", className)}>
      <div className="flex items-center gap-1.5">
        {/* Сегментам подпись не привязывается: у radiogroup своя aria-label */}
        {htmlFor === undefined ? (
          <span className="t-label">{label}</span>
        ) : (
          <label className="t-label" htmlFor={htmlFor}>
            {label}
          </label>
        )}
        {hint && <HelpTip>{hint}</HelpTip>}
      </div>
      {children}
    </div>
  );
}

const SIDE_OPTIONS = [
  { value: "buy" as const, label: "Купить", arrow: "↓" },
  { value: "sell" as const, label: "Продать", arrow: "↑" },
];

export function TradeForm({
  trade,
  onSaved,
  onCancel,
  onDeleted,
}: {
  /** Сделка для редактирования; null — форма добавления. */
  trade: TradeDto | null;
  onSaved: () => void;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const isEdit = trade !== null;
  const [category, setCategory] = useState<PortfolioCategory>(
    trade?.category ?? "btc",
  );
  const [side, setSide] = useState<"buy" | "sell">(trade?.side ?? "buy");
  const [quantity, setQuantity] = useState(trade?.quantity ?? "");
  const [price, setPrice] = useState(() => {
    if (!trade) return "";
    // Сделка без цены хранится нулём — в форме это пустое поле, а не «0»
    const p = parseDecimal(trade.priceUsd);
    return p !== null && p > 0 ? trade.priceUsd : "";
  });
  const [total, setTotal] = useState(() => {
    if (!trade) return "";
    const q = parseDecimal(trade.quantity);
    const p = parseDecimal(trade.priceUsd);
    return q !== null && p !== null && p > 0 ? toInput(q * p) : "";
  });
  // Что пользователь заполнял сам — цену или сумму; второе производное
  const [priceSource, setPriceSource] = useState<"price" | "total">("price");
  const [date, setDate] = useState(
    trade ? trade.tradedAt.slice(0, 10) : todayLocal(),
  );
  const [note, setNote] = useState(trade?.note ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  const cardRef = useRef<HTMLDivElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  // Форма раскрылась (новая сделка или правка) — показать её целиком
  // и поставить курсор в первое поле
  useEffect(() => {
    cardRef.current?.scrollIntoView({ block: "nearest" });
    quantityRef.current?.focus();
  }, []);

  const unit = CATEGORY_UNIT[category];
  // Производное поле подписано «рассчитано»: пользователь должен видеть,
  // какое из двух чисел он ввёл, а какое посчитала форма
  const derivedTotal = priceSource === "price" && total !== "";
  const derivedPrice = priceSource === "total" && price !== "";

  function syncFromQuantity(next: string) {
    setQuantity(next);
    const q = parseDecimal(next);
    if (priceSource === "price") {
      const p = parseDecimal(price);
      setTotal(q !== null && p !== null ? toInput(q * p) : "");
    } else {
      const t = parseDecimal(total);
      setPrice(q !== null && q > 0 && t !== null ? toInput(t / q) : "");
    }
  }

  function syncFromPrice(next: string) {
    setPrice(next);
    setPriceSource("price");
    const q = parseDecimal(quantity);
    const p = parseDecimal(next);
    setTotal(q !== null && p !== null ? toInput(q * p) : "");
  }

  function syncFromTotal(next: string) {
    setTotal(next);
    setPriceSource("total");
    const q = parseDecimal(quantity);
    const t = parseDecimal(next);
    setPrice(q !== null && q > 0 && t !== null ? toInput(t / q) : "");
  }

  function resetAfterAdd() {
    // Сброс всего, кроме категории: серии сделок обычно одной категории
    setSide("buy");
    setQuantity("");
    setPrice("");
    setTotal("");
    setPriceSource("price");
    setDate(todayLocal());
    setNote("");
  }

  /** Обязательны количество и одно из «цена/сумма» — до запроса. */
  function validate(): string | null {
    const q = parseDecimal(quantity);
    if (q === null || q <= 0) {
      quantityRef.current?.focus();
      return "Укажите количество больше нуля";
    }
    if (parseDecimal(price) === null && parseDecimal(total) === null) {
      priceRef.current?.focus();
      return "Укажите цену за единицу или сумму сделки";
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIssues([]);
    const invalid = validate();
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    setPending(true);
    setError(null);
    const payload = {
      category,
      side,
      quantity: quantity.trim(),
      priceUsd: price.trim(),
      tradedAt: date,
      note: note.trim() === "" ? null : note.trim(),
    };
    try {
      if (isEdit) {
        await apiFetch<TradeResponseDto>(`/api/trades/${trade.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast.success("Сделка обновлена");
      } else {
        await apiFetch<TradeResponseDto>("/api/trades", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success("Сделка добавлена");
        resetAfterAdd();
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setIssues(err.issues);
      } else {
        setError("Не удалось сохранить сделку");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    // Обводка --line-strong: раскрытый блок отделяется от карточек в потоке
    <DcCard as="section" className="border-line-strong">
      <div className="flex items-center gap-2.5 border-line border-b px-card py-[15px]">
        <h2 className="t-h3">{isEdit ? "Правка сделки" : "Новая сделка"}</h2>
        <span className="flex-1" />
        {isEdit && <DeleteTradeDialog trade={trade} onDeleted={onDeleted} />}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onCancel}
          aria-label="Закрыть форму"
        >
          <X aria-hidden />
        </Button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4 p-card">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Категория">
            <Segmented
              ariaLabel="Категория"
              value={category}
              onChange={setCategory}
              className="flex w-full [&>button]:flex-1"
              options={TRADE_CATEGORIES.map((c) => ({
                value: c.key,
                label: (
                  <span className="flex items-center justify-center gap-1.5">
                    <CategoryDot category={c.key} size={6} />
                    {c.label}
                  </span>
                ),
              }))}
            />
          </Field>

          <Field label="Сторона">
            <Segmented
              ariaLabel="Сторона сделки"
              value={side}
              onChange={setSide}
              className="flex w-full [&>button]:flex-1"
              options={SIDE_OPTIONS.map((o) => ({
                value: o.value,
                label: (
                  // Направление несёт стрелка: зелёный и красный принадлежат
                  // прибыли и убытку, а не стороне сделки (дизайн-код §2)
                  <span className="flex items-center justify-center gap-[7px]">
                    <span aria-hidden className="text-text-3">
                      {o.arrow}
                    </span>
                    {o.label}
                  </span>
                ),
              }))}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={`Количество, ${unit}`} htmlFor="trade-quantity">
            <Input
              id="trade-quantity"
              ref={quantityRef}
              type="text"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => syncFromQuantity(e.target.value)}
              placeholder={unit === "USD" ? "5000" : "0,1"}
              className="border-line-strong font-mono"
            />
          </Field>

          <Field label="Цена за единицу, $" htmlFor="trade-price">
            <CalculatedField calculated={derivedPrice}>
              <Input
                id="trade-price"
                ref={priceRef}
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => syncFromPrice(e.target.value)}
                placeholder={unit === "USD" ? "1,00" : "60000"}
                className={cn(
                  "font-mono",
                  derivedPrice
                    ? "pr-[92px] text-text-3"
                    : "border-line-strong",
                )}
              />
            </CalculatedField>
          </Field>

          <Field
            label="Сумма, $"
            htmlFor="trade-total"
            hint="Заполните цену или сумму — второе рассчитается из количества автоматически."
          >
            <CalculatedField calculated={derivedTotal}>
              <Input
                id="trade-total"
                type="text"
                inputMode="decimal"
                value={total}
                onChange={(e) => syncFromTotal(e.target.value)}
                placeholder="6000"
                className={cn(
                  "font-mono",
                  derivedTotal ? "pr-[92px] text-text-3" : "border-line-strong",
                )}
              />
            </CalculatedField>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <Field label="Дата" htmlFor="trade-date">
            <Input
              id="trade-date"
              type="date"
              required
              value={date}
              max={todayLocal()}
              onChange={(e) => setDate(e.target.value)}
              className="border-line-strong font-mono"
            />
          </Field>
          <Field label="Заметка" htmlFor="trade-note">
            <Input
              id="trade-note"
              type="text"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Биржа, повод"
            />
          </Field>
        </div>

        {/* Ошибка — инлайн, должна остаться на экране */}
        {error && (
          <div role="status" className="t-meta text-loss">
            <p>{error}</p>
            {issues.length > 0 && (
              <ul className="mt-1 list-inside list-disc">
                {issues.map((i) => (
                  <li key={i}>{humanIssue(i)}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="submit" disabled={pending}>
            {pending
              ? "Сохранение…"
              : isEdit
                ? "Сохранить"
                : "Добавить сделку"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <span className="flex-1" />
          <span className="t-meta text-text-3">
            {side === "buy"
              ? `средняя цена ${CATEGORY_LABEL[category]} пересчитается после сохранения`
              : "продажа среднюю цену не меняет — только реализованный результат"}
          </span>
        </div>
      </form>
    </DcCard>
  );
}

/** Поле с пометкой «рассчитано» — число, которое посчитала форма. */
function CalculatedField({
  calculated,
  children,
}: {
  calculated: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      {children}
      {calculated && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px] text-text-3">
          рассчитано
        </span>
      )}
    </div>
  );
}
