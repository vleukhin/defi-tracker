"use client";

import { Button } from "@/components/ui/button";

/**
 * Постраничная навигация под списком: «Показано N–M из K» + Назад/Вперед.
 *
 * Общая для журнала сделок (страницы приходят с сервера) и списка снепшотов
 * (нарезка на клиенте — графикам нужен весь ряд, серверная пагинация порезала
 * бы и их). Компонент про отображение и ничего не знает про источник страниц.
 */
export function Pagination({
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
