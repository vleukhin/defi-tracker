import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HelpTip } from "./help-tip";

/**
 * Полоса метрик карточки (дизайн-код §5, полоса 2 из четырёх).
 * Разделители — не отступы: сетка с gap 1px на фоне --line даёт
 * волосяные линии между ячейками одним правилом.
 *
 * Ячейка — ровно три уровня: подпись → значение → дельта. Четвёртый
 * уровень означает, что в ячейку положили две метрики вместо одной.
 */
export function MetricGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-px bg-line",
        // 1280 и ниже: 4 колонки складываются в 2, дальше — по ширине ячейки
        columns === 4 && "grid-cols-2 xl:grid-cols-4",
        columns === 3 && "grid-cols-1 sm:grid-cols-3",
        columns === 2 && "grid-cols-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Ячейка метрики. `mono` — деньги и количества токенов (Mono 24px),
 * иначе проценты и ставки (Sans 24px): процент — не сумма, моноширинный
 * он выглядит тяжелее, чем весит.
 */
export function Metric({
  label,
  hint,
  value,
  mono = true,
  tone,
  delta,
  className,
}: {
  label: string;
  hint?: ReactNode;
  /** null = величина неизвестна: рисуется «—», а не «$0,00». */
  value: ReactNode;
  mono?: boolean;
  tone?: "profit" | "loss" | "warn";
  /** Третий уровень: дельта, лимит, пояснение в одну строку. */
  delta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-surface px-card py-3.5", className)}>
      <div className="flex items-center gap-1.5">
        <span className="t-label truncate">{label}</span>
        {hint && <HelpTip>{hint}</HelpTip>}
      </div>
      <p
        className={cn(
          "mt-2",
          mono ? "t-metric" : "t-metric-alt",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss",
          tone === "warn" && "text-warn",
        )}
      >
        {value ?? <span className="text-text-3">—</span>}
      </p>
      {delta != null && (
        <p className="mt-2 text-[12px] text-text-3">{delta}</p>
      )}
    </div>
  );
}

/** Дельта в третьем уровне ячейки: цвет несёт знак, знак — тоже. */
export function Delta({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "profit" | "loss" | "neutral";
}) {
  return (
    <span
      className={cn(
        tone === "profit" && "text-profit",
        tone === "loss" && "text-loss",
        tone === "neutral" && "text-text-3",
      )}
    >
      {children}
    </span>
  );
}
