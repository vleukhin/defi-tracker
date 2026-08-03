"use client";

import { CircleAlert, TriangleAlert } from "lucide-react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { DcCard, Disclaimer, EmptyState } from "@/components/dc/card";
import { MetaDot, PageHeader } from "@/components/dc/page-header";
import { Dash } from "@/components/dc/table";
import { CategoryDot } from "@/components/portfolio/category";
import { countLabel } from "@/components/portfolio/plural";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  LedgerSummaryDto,
  PortfolioCategory,
  TradeDto,
  TradesResponseDto,
} from "@/lib/api/types";
import { dcUsd, dcUsdSigned, tableDate } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { TRADE_CATEGORIES } from "./categories";
import { Collapse } from "./collapse";
import { TradeForm } from "./trade-form";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  TradesFilters,
  type TradeFilters,
} from "./trades-filters";
import { TradesList } from "./trades-list";

/**
 * Экран «Сделки»: заголовок со счётчиком, три карточки итогов по активам,
 * раскрываемая форма и одна карточка «фильтры + таблица + футер».
 *
 * Форма не висит в потоке: primary-кнопка «Новая сделка» — единственная
 * primary на экране, и пока форма раскрыта, она уступает место кнопке
 * «Добавить сделку» внутри формы (дизайн-код §8).
 */

/** Шаг «Показать ещё» и потолок pageSize в /api/trades. */
const PAGE_STEP = 20;
const MAX_PAGE_SIZE = 100;

/** Значение с задержкой: поиск по заметке не бьёт в API на каждую букву. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function TradesManager() {
  const [filters, setFilters] = useState<TradeFilters>(EMPTY_FILTERS);
  // «Показать ещё» растит окно выборки, а не листает страницы: журнал
  // читают сверху вниз. Дальше потолка pageSize окно едет страницами.
  const [limit, setLimit] = useState(PAGE_STEP);
  const [page, setPage] = useState(1);
  const debouncedQ = useDebounced(filters.q, 300);

  const url = useMemo(() => {
    const sp = new URLSearchParams();
    if (filters.category !== "all") sp.set("category", filters.category);
    if (filters.from) sp.set("from", filters.from);
    if (filters.to) sp.set("to", filters.to);
    if (debouncedQ) sp.set("q", debouncedQ);
    if (page > 1) sp.set("page", String(page));
    sp.set("pageSize", String(limit));
    return `/api/trades?${sp.toString()}`;
  }, [filters.category, filters.from, filters.to, debouncedQ, page, limit]);

  const { data, error, loading, refetch } = useApi<TradesResponseDto>(url);
  const [editing, setEditing] = useState<TradeDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const filtersActive = hasActiveFilters(filters);

  // Даты последней сделки в API нет: берём её из первой строки выборки
  // (список приходит новыми вперёд). Под фильтром первая строка — уже не
  // последняя сделка леджера, поэтому дата уходит, а не врёт.
  const lastTradedAt =
    data !== null && !filtersActive && page === 1
      ? (data.trades[0]?.tradedAt ?? null)
      : null;

  /** Смена фильтра всегда возвращает к началу выборки. */
  function applyFilters(next: TradeFilters) {
    setFilters(next);
    setPage(1);
    setLimit(PAGE_STEP);
  }

  function openNewTrade() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(trade: TradeDto) {
    setEditing(trade);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  // Экран не загрузился вовсе — Alert с повтором
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
  // Страница вышла за пределы выборки (сделки удалили из другой вкладки)
  const pageOutOfRange =
    data !== null && data.page.total > 0 && data.trades.length === 0;

  // Oversell и прочие аномалии реплея — предупреждение, не блокировка
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

  return (
    // HelpTip'ы экрана: провайдера тултипов выше по дереву нет
    <TooltipPrimitive.Provider delayDuration={200}>
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Сделки"
          meta={
            data === null ? null : (
              <>
                <span>
                  {countLabel(ledgerTotal, "сделка", "сделки", "сделок")}
                </span>
                {lastTradedAt !== null && (
                  <>
                    <MetaDot />
                    <span>последняя {tableDate(lastTradedAt)}</span>
                  </>
                )}
              </>
            )
          }
          action={
            !formOpen && (
              <Button type="button" onClick={openNewTrade}>
                Новая сделка
              </Button>
            )
          }
        />

        {loading && data === null && (
          <div className="grid gap-3 sm:grid-cols-3">
            {TRADE_CATEGORIES.map((c) => (
              <Skeleton
                key={c.key}
                aria-hidden="true"
                className="h-[104px] rounded-card bg-chip"
              />
            ))}
          </div>
        )}

        {data !== null && !isEmpty && <SummaryCards summary={data.summary} />}

        <Collapse open={formOpen}>
          <TradeForm
            key={editing?.id ?? "new"}
            trade={editing}
            onSaved={() => {
              // Правка закрывает форму; добавление оставляет её открытой
              // под серию сделок — поля уже сброшены
              if (editing !== null) closeForm();
              void refetch();
            }}
            onCancel={closeForm}
            onDeleted={() => {
              closeForm();
              // Удалили последнюю строку страницы — уходим на предыдущую
              if (data !== null && data.trades.length === 1 && page > 1) {
                setPage(page - 1);
              }
              void refetch();
            }}
          />
        </Collapse>

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

        {loading && data === null && (
          <Skeleton
            aria-hidden="true"
            className="h-[320px] rounded-card bg-chip"
          />
        )}

        {isEmpty && (
          <DcCard as="section">
            <EmptyState
              title="Сделок пока нет"
              action={
                <Button type="button" variant="outline" onClick={openNewTrade}>
                  Добавить первую сделку
                </Button>
              }
            />
          </DcCard>
        )}

        {data !== null && !isEmpty && (
          <DcCard as="section">
            <TradesFilters
              filters={filters}
              onChange={applyFilters}
              onReset={() => applyFilters(EMPTY_FILTERS)}
            />

            {noMatches && (
              <EmptyState
                title="Под фильтры не подходит ни одна сделка"
                action={
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => applyFilters(EMPTY_FILTERS)}
                  >
                    Сбросить фильтры
                  </Button>
                }
              />
            )}

            {pageOutOfRange && (
              <EmptyState
                title="Сделок стало меньше, чем было при переходе сюда"
                action={
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPage(1)}
                  >
                    К началу списка
                  </Button>
                }
              />
            )}

            {!noMatches && !pageOutOfRange && (
              <>
                <TradesList trades={data.trades} onEdit={openEdit} />
                <TableFooter
                  page={data.page.page}
                  pageSize={data.page.pageSize}
                  total={data.page.total}
                  loading={loading}
                  onMore={() => {
                    if (limit < MAX_PAGE_SIZE) {
                      setLimit(Math.min(limit + PAGE_STEP, MAX_PAGE_SIZE));
                    } else {
                      setPage(page + 1);
                    }
                  }}
                  onBack={() => setPage(Math.max(1, page - 1))}
                />
              </>
            )}
          </DcCard>
        )}

        {data !== null && !isEmpty && (
          <Disclaimer>
            Сделки со суммой «—» внесены без цены: количество учтено, средняя
            цена по ним не считается.
          </Disclaimer>
        )}
      </div>
    </TooltipPrimitive.Provider>
  );
}

/**
 * Итоги леджера по трём активам. Средняя цена — крупное число карточки
 * (Mono 24), реализованный результат — Sans 19 цветом семантики; нет
 * покупок или продаж — «—», а не «$0,00» (дизайн-код §4).
 */
function SummaryCards({
  summary,
}: {
  summary: Record<PortfolioCategory, LedgerSummaryDto>;
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {TRADE_CATEGORIES.map((c) => {
        const s = summary[c.key];
        const realized = s.realizedPnlUsd;
        return (
          <DcCard key={c.key} className="px-card pt-4 pb-[18px]">
            <div className="flex items-center gap-2">
              <CategoryDot category={c.key} size={7} />
              <span className="text-[14px] font-semibold">{c.label}</span>
              <span className="flex-1" />
              <span className="t-meta text-text-3">
                {countLabel(s.tradeCount, "сделка", "сделки", "сделок")}
              </span>
            </div>
            <div className="mt-3.5 flex items-end gap-6">
              <div className="flex flex-col gap-1">
                <span className="t-label whitespace-nowrap">Средняя цена</span>
                <span className="t-metric">
                  {s.avgPriceUsd === null ? <Dash /> : dcUsd(s.avgPriceUsd)}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="t-label whitespace-nowrap">Реализовано</span>
                <span
                  className={
                    realized === 0
                      ? "t-metric-sm text-text-3"
                      : realized > 0
                        ? "t-metric-sm text-profit"
                        : "t-metric-sm text-loss"
                  }
                >
                  {realized === 0 ? <Dash /> : dcUsdSigned(realized)}
                </span>
              </div>
            </div>
          </DcCard>
        );
      })}
    </section>
  );
}

/** Футер таблицы: «показаны 8 из 39» + «Показать ещё». */
function TableFooter({
  page,
  pageSize,
  total,
  loading,
  onMore,
  onBack,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onMore: () => void;
  onBack: () => void;
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const hasMore = last < total;

  return (
    <div className="flex flex-wrap items-center gap-3 border-line border-t px-card py-3">
      <span className="t-meta text-text-3" aria-live="polite">
        показаны {page === 1 ? last : `${first}–${last}`} из {total}
      </span>
      <span className="flex-1" />
      {page > 1 && (
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          Назад
        </Button>
      )}
      {hasMore && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={onMore}
        >
          Показать ещё
        </Button>
      )}
    </div>
  );
}
