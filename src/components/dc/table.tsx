import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Таблица дизайн-кода (§4): шапка набрана --type-label, числа выровнены
 * вправо, пустое значение — «—», а не «$0,00». Строки разделены волосяной
 * линией --line; итоговая строка уходит на фон --bg-sunken.
 *
 * На 768 и ниже таблица не ломается на «label — значение», а получает
 * горизонтальный скролл: колонок много, и сравнение строк между собой —
 * то, ради чего таблица здесь и стоит.
 *
 * Но скролл нужно было ещё и показать. На телефоне полоса прокрутки скрыта,
 * и таблица в 860-980px при рабочей ширине ~343px выглядела просто обрезанной:
 * пользователь не знал, что за краем есть «Отклон.» и «К ребаланс.». Отсюда
 * .dc-scroll-x — тень у края, которая гаснет, когда прокручивать больше
 * некуда, — и залипающая первая колонка, чтобы числа не отрывались от актива.
 */
export function DcTable({
  children,
  className,
  minWidth = 720,
}: {
  children: ReactNode;
  className?: string;
  minWidth?: number;
}) {
  return (
    <div className="dc-scroll-x">
      <table
        className={cn("w-full border-collapse text-[13px]", className)}
        style={{ minWidth }}
      >
        {children}
      </table>
    </div>
  );
}

/**
 * Первая колонка остаётся на месте при горизонтальной прокрутке.
 *
 * Фон обязателен и непрозрачен: под залипающей ячейкой едут остальные.
 * Строки при этом остаются прозрачными — сквозь них видна тень у края,
 * которую рисует .dc-scroll-x. Отклонения от --bg-surface (наведение,
 * итоговая строка) дописывают Tr и TotalRow.
 */
const STICKY_FIRST = "first:sticky first:left-0 first:z-10 first:bg-surface";

export function Th({
  children,
  numeric,
  className,
  ...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "t-label whitespace-nowrap border-line border-b px-3 py-2.5 font-semibold first:pl-card last:pr-card",
        STICKY_FIRST,
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function Tr({
  children,
  className,
  ...props
}: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        // Наведение перекрашивает и залипающую ячейку: у неё собственный
        // непрозрачный фон, и без этого правила она осталась бы прежней
        "border-line border-b transition-colors duration-120 ease-out last:border-0 hover:bg-chip hover:[&>*:first-child]:bg-chip",
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  numeric,
  mono,
  muted,
  className,
  ...props
}: React.ComponentProps<"td"> & {
  numeric?: boolean;
  mono?: boolean;
  muted?: boolean;
}) {
  // Ячейка на несколько колонок — это раскрытая строка-подробность, а не
  // первая колонка: залипание растянуло бы её на всю ширину и заморозило
  return (
    <td
      className={cn(
        "whitespace-nowrap px-3 py-2.5 first:pl-card last:pr-card",
        props.colSpan == null && STICKY_FIRST,
        numeric && "text-right",
        mono && "font-mono",
        muted ? "text-text-3" : "text-text-1",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

/** Итоговая строка: та же сетка колонок, но на фоне --bg-sunken. */
export function TotalRow({
  children,
  className,
  ...props
}: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-line border-t bg-sunken font-medium [&>*:first-child]:bg-sunken",
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

/** Пустая ячейка. Ноль и «неизвестно» — разные вещи, и выглядят по-разному. */
export function Dash() {
  return <span className="text-text-3">—</span>;
}
