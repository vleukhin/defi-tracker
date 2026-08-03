"use client";

import { Button } from "@/components/ui/button";

/**
 * Постраничная навигация под списком: «показаны 1–20 из 39» + Назад/Вперёд.
 *
 * Используется списком снепшотов (нарезка на клиенте — графикам нужен весь
 * ряд, серверная пагинация порезала бы и их). Журнал сделок листается иначе:
 * там окно выборки растёт кнопкой «Показать ещё» в футере той же карточки.
 *
 * Набор дизайн-кода: подпись 12,5px --text-3, кнопки ghost-обводкой.
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="t-meta text-text-3">
        показаны {first}–{last} из {total}
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
            className="t-meta text-text-3"
            aria-live="polite"
            aria-atomic="true"
          >
            стр. {page} из {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
          >
            Вперёд
          </Button>
        </div>
      )}
    </div>
  );
}
