import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HelpTip } from "./help-tip";

/**
 * Каркас карточки дизайн-кода (§5): поверхность --bg-surface, обводка
 * --line-card, радиус 14, поля 18. Теней нет — тень только у всплывающих
 * слоёв. Плотность держат волосяные линии и смена фона, а не отступы.
 */
export function DcCard({
  children,
  className,
  as: Tag = "div",
  hoverable,
  ...props
}: React.ComponentProps<"div"> & {
  as?: "div" | "section" | "article" | "li";
  /** Карточки-ссылки и карточки позиций светлеют обводкой по hover. */
  hoverable?: boolean;
}) {
  // Тег — union, и TS не сводит `ref` четырёх разных элементов к одному
  // типу. Пропсы у них здесь общие (div-овские), поэтому ElementType.
  const Component = Tag as React.ElementType;
  return (
    <Component
      className={cn(
        "overflow-hidden rounded-card border border-line-card bg-surface transition-colors duration-120 ease-out",
        hoverable && "hover:border-line-strong",
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

/** Вложенный блок внутри карточки: фон --bg-sunken, радиус 12. */
export function DcBlock({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-block bg-sunken", className)}>{children}</div>
  );
}

/**
 * Заголовок секции: h2 + «?» слева, действие справа.
 * Объяснение методики уходит в «?», в поток не попадает.
 */
export function SectionHead({
  title,
  hint,
  count,
  note,
  action,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  /** Счётчик рядом с заголовком: «12», «3 адреса». */
  count?: ReactNode;
  /** Поясняющая строка под заголовком — одно предложение, не абзац. */
  note?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-center justify-between gap-3 px-card py-3.5", className)}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="t-h2 truncate">{title}</h2>
          {count != null && (
            <span className="t-meta shrink-0 text-text-3">{count}</span>
          )}
          {hint && <HelpTip size="md">{hint}</HelpTip>}
        </div>
        {note != null && (
          <p className="t-meta mt-0.5 text-text-3">{note}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * Строка-вывод (§7): что это значит для стратегии. Утверждение, не
 * инструкция — «заёмные окупаются», а не «стоит закрыть заём».
 * Ровно одна строка на карточку, 12,5px, --text-2.
 */
export function Verdict({
  children,
  chip,
  className,
}: {
  children: ReactNode;
  /** Нейтральный чип-связь справа: «связано с займом на Aave». */
  chip?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-line border-t px-card py-3",
        className,
      )}
    >
      <p className="t-meta flex min-w-0 items-baseline gap-2 text-text-2">
        <span
          aria-hidden
          className="size-[3px] shrink-0 translate-y-[-3px] rounded-full bg-text-4"
        />
        <span className="min-w-0">{children}</span>
      </p>
      {chip}
    </div>
  );
}

/** Дисклеймер страницы — один раз внизу, 12px, --text-3. */
export function Disclaimer({ children }: { children?: ReactNode }) {
  return (
    <p className="text-[12px] text-text-3">
      {children ?? "Расчёт, а не финансовый совет."}
    </p>
  );
}

/** Пустое состояние: «Записей пока нет» + предложенное действие. */
export function EmptyState({
  title = "Записей пока нет",
  action,
}: {
  title?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-card py-10 text-center">
      <p className="t-body text-text-2">{title}</p>
      {action}
    </div>
  );
}
