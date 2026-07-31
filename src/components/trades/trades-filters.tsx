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

/** Переехала в @/components/pagination — общая со списком снепшотов. */
export { Pagination as TradesPagination } from "@/components/pagination";
