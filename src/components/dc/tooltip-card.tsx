import type { ReactNode } from "react";

/**
 * Карточка всплывающего значения — одна на графики и на полосы данных
 * (дизайн-код §5): подпись мелко сверху, значение крупно снизу.
 * Значение — то, за чем к визуалу пришли, и читаться оно должно первым.
 *
 * Поверхность та же, что у «?» и у тултипов Radix: --bg-raised, обводка
 * --line-strong, радиус 9, тень --shadow-pop. Расходиться им нельзя —
 * на экране «Портфель» карточка графика и подсказка сегмента полосы
 * встречаются в одном взгляде.
 */
export function TooltipCard({
  title,
  children,
  note,
}: {
  /** Дата точки на графике, название сегмента на полосе. */
  title: string;
  children: ReactNode;
  /** Оговорка о достоверности — «частичные данные». */
  note?: ReactNode;
}) {
  return (
    <div className="rounded-[9px] border border-line-strong bg-raised px-3 py-2 whitespace-nowrap shadow-(--shadow-pop)">
      <div className="font-mono text-[11.5px] text-text-3">{title}</div>
      <div className="mt-0.5 font-mono text-[15px] leading-tight font-medium text-text-1">
        {children}
      </div>
      {note && <div className="mt-1 text-[11.5px] text-warn">{note}</div>}
    </div>
  );
}
