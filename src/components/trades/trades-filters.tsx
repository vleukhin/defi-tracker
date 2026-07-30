"use client";

import { Search, X } from "lucide-react";
import { CategoryDot } from "@/components/portfolio/category";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PortfolioCategory } from "@/lib/api/types";
import { TRADE_CATEGORIES } from "./categories";

/**
 * Фильтры журнала сделок: категория, период и подстрока заметки.
 *
 * Фильтры сужают только СПИСОК. Сводка (средняя цена, realized P/L) всегда
 * считается по всему леджеру — иначе средняя показывала бы неверное число.
 */

export interface TradeFilters {
  category: PortfolioCategory | "all";
  from: string;
  to: string;
  q: string;
}

export const EMPTY_FILTERS: TradeFilters = {
  category: "all",
  from: "",
  to: "",
  q: "",
};

export function hasActiveFilters(f: TradeFilters): boolean {
  return f.category !== "all" || f.from !== "" || f.to !== "" || f.q !== "";
}

/** Тот же сегментированный переключатель, что и в форме сделки. */
const SEGMENT =
  "flex h-9 cursor-pointer select-none items-center justify-center gap-1.5 rounded-md border border-input px-2 text-sm transition-colors duration-120 ease-out hover:bg-accent/60 has-checked:border-ring has-checked:bg-accent has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

export function TradesFilters({
  filters,
  onChange,
  onReset,
}: {
  filters: TradeFilters;
  onChange: (next: TradeFilters) => void;
  onReset: () => void;
}) {
  const active = hasActiveFilters(filters);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Фильтры</h2>
        {active && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-7 text-muted-foreground"
          >
            <X className="size-3.5" />
            Сбросить
          </Button>
        )}
      </div>

      <fieldset>
        <legend className="sr-only">Категория</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className={SEGMENT}>
            <input
              type="radio"
              name="filter-category"
              value="all"
              checked={filters.category === "all"}
              onChange={() => onChange({ ...filters, category: "all" })}
              className="sr-only"
            />
            <span>Все</span>
          </label>
          {TRADE_CATEGORIES.map((c) => (
            <label key={c.key} className={SEGMENT}>
              <input
                type="radio"
                name="filter-category"
                value={c.key}
                checked={filters.category === c.key}
                onChange={() => onChange({ ...filters, category: c.key })}
                className="sr-only"
              />
              <CategoryDot category={c.key} />
              <span className="truncate">{c.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="filter-from">Дата с</Label>
          <Input
            id="filter-from"
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => onChange({ ...filters, from: e.target.value })}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="filter-to">Дата по</Label>
          <Input
            id="filter-to"
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => onChange({ ...filters, to: e.target.value })}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="filter-q">Заметка</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="filter-q"
              type="search"
              value={filters.q}
              maxLength={100}
              onChange={(e) => onChange({ ...filters, q: e.target.value })}
              placeholder="Поиск по заметке"
              className="pl-8"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Постраничная навигация под списком. */
export function TradesPagination({
  page,
  pageSize,
  total,
  totalPages,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">
        Показано <span className="font-mono">{first}</span>–
        <span className="font-mono">{last}</span> из{" "}
        <span className="font-mono">{total}</span>
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            Назад
          </Button>
          <span
            className="text-xs text-muted-foreground"
            aria-live="polite"
            aria-atomic="true"
          >
            Стр. <span className="font-mono">{page}</span> из{" "}
            <span className="font-mono">{totalPages}</span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
          >
            Вперед
          </Button>
        </div>
      )}
    </div>
  );
}
