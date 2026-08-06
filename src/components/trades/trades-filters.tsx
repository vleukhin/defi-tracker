"use client";

import { Search, X } from "lucide-react";
import { FilterChips } from "@/components/dc/segmented";
import { CategoryDot } from "@/components/portfolio/category";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PortfolioCategory } from "@/lib/api/types";
import { TRADE_CATEGORIES } from "./categories";

/**
 * Фильтры журнала сделок: актив, период и подстрока заметки.
 *
 * Живут строкой в шапке той же карточки, что и таблица (README, п.4):
 * отдельным блоком они читались как самостоятельный раздел, хотя сужают
 * ровно одну таблицу под собой.
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

const CATEGORY_OPTIONS: {
  value: PortfolioCategory | "all";
  label: React.ReactNode;
}[] = [
  { value: "all", label: "Все" },
  ...TRADE_CATEGORIES.map((c) => ({
    value: c.key,
    label: (
      <span className="flex items-center gap-1.5">
        <CategoryDot category={c.key} size={6} />
        {c.label}
      </span>
    ),
  })),
];

/**
 * Компактное поле даты внутри пилюли диапазона.
 *
 * До md поля делят ширину пилюли поровну (flex-1 + min-w-0), а не встают
 * по своей интринсивной ширине: нативный date-input на iOS и Android
 * шире min-w-[92px], и пара таких полей перебирала ширину экрана.
 */
const DATE_INPUT =
  "min-w-0 flex-1 bg-transparent font-mono text-base text-text-2 outline-none md:min-w-[92px] md:flex-initial md:text-[12.5px]";

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
    <div className="flex flex-wrap items-center gap-2 border-line border-b px-card py-3">
      <FilterChips
        options={CATEGORY_OPTIONS}
        value={filters.category}
        onChange={(category) => onChange({ ...filters, category })}
        ariaLabel="Фильтр по активу"
      />

      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-card" />

      {/* Диапазон дат — одна пилюля: две даты читаются как один фильтр */}
      <div className="flex h-[30px] w-full items-center gap-1.5 rounded-control border border-line-card px-2.5 transition-colors duration-120 ease-out pointer-coarse:h-11 focus-within:border-[var(--accent)] focus-within:ring-3 focus-within:ring-ring/50 sm:w-auto">
        <input
          type="date"
          aria-label="Сделки с даты"
          value={filters.from}
          max={filters.to || undefined}
          onChange={(e) => onChange({ ...filters, from: e.target.value })}
          className={DATE_INPUT}
        />
        <span aria-hidden className="text-text-4">
          →
        </span>
        <input
          type="date"
          aria-label="Сделки по дату"
          value={filters.to}
          min={filters.from || undefined}
          onChange={(e) => onChange({ ...filters, to: e.target.value })}
          className={DATE_INPUT}
        />
      </div>

      <span className="flex-1" />

      {active && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="text-text-3"
        >
          <X aria-hidden />
          Сбросить
        </Button>
      )}

      <div className="relative w-full sm:w-[220px]">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-4"
        />
        <Input
          id="filter-q"
          type="search"
          aria-label="Поиск по заметке"
          value={filters.q}
          maxLength={100}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder="Поиск по заметке"
          className="h-[30px] w-full pl-8 text-base md:text-[12.5px]"
        />
      </div>
    </div>
  );
}
