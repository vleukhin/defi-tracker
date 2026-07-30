"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CategoryDot } from "@/components/portfolio/category";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  PortfolioCategory,
  TradeDto,
  TradeResponseDto,
} from "@/lib/api/types";
import { ApiError, apiFetch } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { CATEGORY_UNIT, TRADE_CATEGORIES } from "./categories";

/**
 * Форма сделки (S2.1): категория, сторона, количество, «цена за единицу ИЛИ
 * сумма всего» (второе выводится из количества автоматически), дата (не в
 * будущем), опциональные комиссия и заметка.
 *
 * Одна форма на добавление и редактирование: «Изменить» в списке передает
 * trade — родитель перемонтирует форму через key, initializers useState
 * подхватывают значения. Отправляется всегда priceUsd — производная от
 * суммы, если пользователь заполнял сумму.
 */

/** Сегмент радио-контрола: состояние — от скрытого input (has-checked). */
const SEGMENT =
  "flex h-9 cursor-pointer select-none items-center justify-center gap-2 rounded-md border border-input px-2 text-sm transition-colors duration-120 ease-out hover:bg-accent/60 has-checked:border-ring has-checked:bg-accent has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

/** Десятичная строка инпута в число; запятая толерантна, как в API. */
function parseDecimal(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number.parseFloat(raw.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Число обратно в инпут: без экспоненты, хвостовые нули срезаны. */
function toInput(n: number): string {
  if (!Number.isFinite(n)) return "";
  return n
    .toFixed(8)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
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

export function TradeForm({
  trade,
  onSaved,
  onCancel,
}: {
  /** Сделка для редактирования; null — форма добавления. */
  trade: TradeDto | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEdit = trade !== null;
  const [category, setCategory] = useState<PortfolioCategory>(
    trade?.category ?? "btc",
  );
  const [side, setSide] = useState<"buy" | "sell">(trade?.side ?? "buy");
  const [quantity, setQuantity] = useState(trade?.quantity ?? "");
  const [price, setPrice] = useState(trade?.priceUsd ?? "");
  const [total, setTotal] = useState(() => {
    if (!trade) return "";
    const q = parseDecimal(trade.quantity);
    const p = parseDecimal(trade.priceUsd);
    return q !== null && p !== null ? toInput(q * p) : "";
  });
  // Что пользователь заполнял сам — цену или сумму; второе производное
  const [priceSource, setPriceSource] = useState<"price" | "total">("price");
  const [date, setDate] = useState(
    trade ? trade.tradedAt.slice(0, 10) : todayLocal(),
  );
  const [fee, setFee] = useState(trade?.feeUsd ?? "");
  const [note, setNote] = useState(trade?.note ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  const cardRef = useRef<HTMLDivElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);

  // «Изменить» из списка: форма выше по странице — показать и сфокусировать
  useEffect(() => {
    if (!isEdit) return;
    cardRef.current?.scrollIntoView({ block: "nearest" });
    quantityRef.current?.focus();
  }, [isEdit]);

  const unit = CATEGORY_UNIT[category];

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
    // Сброс всего, кроме категории (S2.1): серии сделок одной категории
    setSide("buy");
    setQuantity("");
    setPrice("");
    setTotal("");
    setPriceSource("price");
    setDate(todayLocal());
    setFee("");
    setNote("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setIssues([]);
    const payload = {
      category,
      side,
      quantity: quantity.trim(),
      priceUsd: price.trim(),
      feeUsd: fee.trim() === "" ? null : fee.trim(),
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
    <Card ref={cardRef} className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <h2 className="text-sm font-semibold">
          {isEdit ? "Изменить сделку" : "Новая сделка"}
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset>
            <legend className="text-sm font-medium">Категория</legend>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {TRADE_CATEGORIES.map((c) => (
                <label key={c.key} className={SEGMENT}>
                  <input
                    type="radio"
                    name="trade-category"
                    value={c.key}
                    checked={category === c.key}
                    onChange={() => setCategory(c.key)}
                    className="sr-only"
                  />
                  <CategoryDot category={c.key} />
                  <span className="truncate">{c.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">Сторона</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <label className={cn(SEGMENT, "has-checked:text-success")}>
                <input
                  type="radio"
                  name="trade-side"
                  value="buy"
                  checked={side === "buy"}
                  onChange={() => setSide("buy")}
                  className="sr-only"
                />
                Купить
              </label>
              <label className={cn(SEGMENT, "has-checked:text-destructive")}>
                <input
                  type="radio"
                  name="trade-side"
                  value="sell"
                  checked={side === "sell"}
                  onChange={() => setSide("sell")}
                  className="sr-only"
                />
                Продать
              </label>
            </div>
          </fieldset>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="trade-quantity">Количество ({unit})</Label>
            <Input
              id="trade-quantity"
              ref={quantityRef}
              type="text"
              required
              inputMode="decimal"
              value={quantity}
              onChange={(e) => syncFromQuantity(e.target.value)}
              placeholder={unit === "USD" ? "5000" : "0.1"}
              className="text-right font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trade-price">Цена за единицу, $</Label>
            <Input
              id="trade-price"
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => syncFromPrice(e.target.value)}
              placeholder={unit === "USD" ? "1.00" : "60000"}
              className="text-right font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trade-total">Сумма всего, $</Label>
            <Input
              id="trade-total"
              type="text"
              inputMode="decimal"
              value={total}
              onChange={(e) => syncFromTotal(e.target.value)}
              placeholder="6000"
              className="text-right font-mono"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Заполните цену или сумму — второе рассчитается из количества
          автоматически.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="trade-date">Дата</Label>
            <Input
              id="trade-date"
              type="date"
              required
              value={date}
              max={todayLocal()}
              onChange={(e) => setDate(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trade-fee">Комиссия, $ (не обяз.)</Label>
            <Input
              id="trade-fee"
              type="text"
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="—"
              className="text-right font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trade-note">Заметка (не обяз.)</Label>
            <Input
              id="trade-note"
              type="text"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Биржа, повод"
            />
          </div>
        </div>

        {/* Ошибка — инлайн, должна остаться на экране (§6.2) */}
        {error && (
          <div role="status" className="text-sm text-destructive">
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

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending
              ? "Сохранение…"
              : isEdit
                ? "Сохранить"
                : "Добавить сделку"}
          </Button>
          {isEdit && (
            <Button type="button" variant="secondary" onClick={onCancel}>
              Отмена
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
