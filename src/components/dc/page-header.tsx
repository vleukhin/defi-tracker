import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Шапка страницы (чек-лист §8): h1 и время обновления данных слева,
 * переключатель режима или создающее действие справа.
 */
export function PageHeader({
  title,
  meta,
  action,
  className,
}: {
  title: ReactNode;
  /** Строка свежести данных или счётчик записей. */
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-wrap items-end justify-between gap-3", className)}
    >
      <div className="min-w-0">
        <h1 className="t-h1">{title}</h1>
        {meta != null && (
          <div className="t-meta mt-1.5 flex flex-wrap items-center gap-x-1.5 text-text-3">
            {meta}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * Свежесть данных: зелёная точка 6px с гало. Точка — единственный случай,
 * когда семантический зелёный не число: это статус, а не результат.
 * `stale` переводит её в warn — «данные устарели».
 */
export function FreshnessDot({ stale }: { stale?: boolean }) {
  const color = stale ? "var(--warn)" : "var(--profit)";
  return (
    <span
      aria-hidden
      className="inline-block size-[6px] shrink-0 rounded-full"
      style={{
        background: color,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    />
  );
}

/** Разделитель мета-строки — точка цветом --text-4. */
export function MetaDot() {
  return (
    <span aria-hidden className="text-text-4">
      ·
    </span>
  );
}

/**
 * Плитка протокола 34px: моно-аббревиатура на фоне в тон бренда.
 * Реальный логотип встаёт в ту же плитку, не меняя каркас шапки.
 */
export function ProtocolTile({
  abbr,
  color,
  size = 34,
  className,
}: {
  abbr: string;
  /** Фирменный цвет протокола; из него берутся фон 12% и обводка 26%. */
  color: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-[10px] font-mono font-medium",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size <= 30 ? 10 : 11,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 26%, transparent)`,
        color,
      }}
    >
      {abbr}
    </span>
  );
}
