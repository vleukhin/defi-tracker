"use client";

import { ArrowLeftRight, CircleAlert, SearchX, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CategoryDot, categoryTint } from "@/components/portfolio/category";
import { formatPnl, pnlClass } from "@/components/pnl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  LedgerSummaryDto,
  PortfolioCategory,
  TradeDto,
  TradesResponseDto,
} from "@/lib/api/types";
import { tableUsd, usdDecimals } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { TRADE_CATEGORIES } from "./categories";
import { TradeForm } from "./trade-form";
import {
  EMPTY_FILTERS,
  TradesFilters,
  TradesPagination,
  type TradeFilters,
} from "./trades-filters";
import { TradesList } from "./trades-list";

/**
 * Экран «Сделки» (Фаза 2, S2.1): сводка леджера по категориям, форма
 * добавления/редактирования и список сделок. Средняя и P/L считаются
 * реплеем на бэкенде — здесь только отображение summary.
 */

/** Значение с задержкой: поиск по заметке не бьет в API на каждую букву. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** «1 сделка / 2 сделки / 5 сделок». */
function tradesWord(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return "сделок";
  if (mod10 === 1) return "сделка";
  if (mod10 >= 2 && mod10 <= 4) return "сделки";
  return "сделок";
}

export function TradesManager() {
  const [filters, setFilters] = useState<TradeFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  // Поиск по заметке дебаунсится: иначе запрос на каждое нажатие клавиши
  const debouncedQ = useDebounced(filters.q, 300);

  const url = useMemo(() => {
    const sp = new URLSearchParams();
    if (filters.category !== "all") sp.set("category", filters.category);
    if (filters.from) sp.set("from", filters.from);
    if (filters.to) sp.set("to", filters.to);
    if (debouncedQ) sp.set("q", debouncedQ);
    if (page > 1) sp.set("page", String(page));
    const qs = sp.toString();
    return qs ? `/api/trades?${qs}` : "/api/trades";
  }, [filters.category, filters.from, filters.to, debouncedQ, page]);

  const { data, error, loading, refetch } = useApi<TradesResponseDto>(url);
  const [editing, setEditing] = useState<TradeDto | null>(null);
  const formAnchorRef = useRef<HTMLDivElement>(null);

  /** Смена фильтра всегда возвращает на первую страницу. */
  function applyFilters(next: TradeFilters) {
    setFilters(next);
    setPage(1);
  }


  // Экран не загрузился вовсе — Alert с повтором (§6.2)
  if (error && !data) {
    return (
      <Alert variant="destructive">
        <CircleAlert className="size-4" />
        <AlertTitle>Не удалось загрузить сделки: {error}</AlertTitle>
        <AlertDescription>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            className="mt-2"
          >
            Повторить
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // Пустой леджер определяется по сводке (она не зависит от фильтров),
  // иначе «ничего не найдено» выглядело бы как «сделок вообще нет».
  const ledgerTotal =
    data === null
      ? 0
      : TRADE_CATEGORIES.reduce(
          (sum, c) => sum + data.summary[c.key].tradeCount,
          0,
        );
  const isEmpty = data !== null && ledgerTotal === 0;
  const noMatches = data !== null && !isEmpty && data.page.total === 0;
  // Страница вышла за пределы выборки (например, сделки удалили из другой
  // вкладки): показываем не пустоту, а возврат к первой странице
  const pageOutOfRange =
    data !== null && data.page.total > 0 && data.trades.length === 0;

  // Oversell и прочие аномалии реплея — предупреждение, не блокировка (S2.1)
  const ledgerWarnings =
    data === null
      ? []
      : TRADE_CATEGORIES.flatMap((c) =>
          data.summary[c.key].warnings.map((text) => ({
            key: `${c.key}:${text}`,
            label: c.label,
            text,
          })),
        );

  function focusForm() {
    formAnchorRef.current?.scrollIntoView({ block: "nearest" });
    document.getElementById("trade-quantity")?.focus();
  }

  return (
    <div className="space-y-4">
      {/* Скелетоны формой повторяют будущий контент (§6.1) */}
      {loading && !data && (
        <Skeleton className="h-[104px] rounded-xl" aria-hidden="true" />
      )}

      {data !== null && !isEmpty && <SummaryStrip summary={data.summary} />}

      {isEmpty && <EmptyState onAdd={focusForm} />}

      <div ref={formAnchorRef}>
        <TradeForm
          key={editing?.id ?? "new"}
          trade={editing}
          onSaved={() => {
            setEditing(null);
            void refetch();
          }}
          onCancel={() => setEditing(null)}
        />
      </div>

      {ledgerWarnings.length > 0 && (
        <Alert variant="warning">
          <TriangleAlert className="size-4" />
          <AlertTitle>Продано больше, чем куплено</AlertTitle>
          <AlertDescription>
            <ul className="space-y-0.5">
              {ledgerWarnings.map((w) => (
                <li key={w.key}>
                  {w.label}: {w.text}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {loading && !data && (
        <Skeleton className="h-40 rounded-xl" aria-hidden="true" />
      )}

      {data !== null && !isEmpty && (
        <TradesFilters
          filters={filters}
          onChange={applyFilters}
          onReset={() => applyFilters(EMPTY_FILTERS)}
        />
      )}

      {noMatches && (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <SearchX className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Ничего не найдено</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Под выбранные фильтры не подходит ни одна сделка. Средняя цена и
            P/L по-прежнему считаются по всему леджеру.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => applyFilters(EMPTY_FILTERS)}
          >
            Сбросить фильтры
          </Button>
        </Card>
      )}

      {pageOutOfRange && (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <p className="text-sm font-medium">Страница пуста</p>
          <p className="text-xs text-muted-foreground">
            Сделок стало меньше, чем было при переходе на эту страницу.
          </p>
          <Button variant="outline" size="sm" onClick={() => setPage(1)}>
            К первой странице
          </Button>
        </Card>
      )}

      {data !== null && !isEmpty && !noMatches && !pageOutOfRange && (
        <>
          <TradesList
            trades={data.trades}
            onEdit={(trade) => setEditing(trade)}
            onDeleted={() => {
              // Удалили редактируемую — форма не должна сохранять призрака
              setEditing(null);
              // Удалили последнюю строку страницы — уходим на предыдущую
              if (data.trades.length === 1 && page > 1) setPage(page - 1);
              void refetch();
            }}
          />
          <TradesPagination
            page={data.page.page}
            pageSize={data.page.pageSize}
            total={data.page.total}
            totalPages={data.page.totalPages}
            onPage={setPage}
          />
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Средняя цена — взвешенная по покупкам; продажа среднюю не меняет.
        Расчеты, а не финансовые советы.
      </p>
    </div>
  );
}

/**
 * Сводка леджера по категориям со сделками: средняя цена покупки
 * и realized P/L (цвет по знаку, знак обязательно в тексте).
 */
function SummaryStrip({
  summary,
}: {
  summary: Record<PortfolioCategory, LedgerSummaryDto>;
}) {
  const active = TRADE_CATEGORIES.filter((c) => summary[c.key].tradeCount > 0);
  if (active.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {active.map((c) => {
        const s = summary[c.key];
        return (
          <Card
            key={c.key}
            className="space-y-2 p-4"
            style={{ background: categoryTint(c.key) }}
          >
            <div className="flex items-center gap-2">
              <CategoryDot category={c.key} />
              <span className="text-sm font-medium">{c.label}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                <span className="font-mono">{s.tradeCount}</span>{" "}
                {tradesWord(s.tradeCount)}
              </span>
            </div>
            <dl className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground">
                  Средняя цена
                </dt>
                <dd className="font-mono text-sm">
                  {s.avgPriceUsd === null ? (
                    <span title="нет данных о цене покупки">—</span>
                  ) : (
                    tableUsd(s.avgPriceUsd, usdDecimals(s.avgPriceUsd))
                  )}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground">
                  Реализовано
                </dt>
                <dd
                  className={`font-mono text-sm ${pnlClass(s.realizedPnlUsd)}`}
                >
                  {formatPnl(s.realizedPnlUsd, null)}
                </dd>
              </div>
            </dl>
          </Card>
        );
      })}
    </div>
  );
}

/** Пустой леджер: зачем он нужен + CTA к первой сделке (§6.3). */
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="p-6 text-center">
      <div className="mb-3 flex justify-center">
        <ArrowLeftRight
          aria-hidden="true"
          className="size-6 text-muted-foreground opacity-60"
        />
      </div>
      <p className="text-base font-medium">Сделок пока нет</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Журнал сделок считает среднюю цену покупки и P/L по каждой категории.
        Запишите первую покупку — в таблице портфеля появятся столбцы «Средняя»
        и «P/L».
      </p>
      <Button className="mt-4" onClick={onAdd}>
        Добавить первую сделку
      </Button>
    </Card>
  );
}
