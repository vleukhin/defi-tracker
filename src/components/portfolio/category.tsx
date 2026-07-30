import type { PortfolioCategory } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Цвета категорий (ТЗ §1.3): только как заливки — точки, сегменты полосы,
 * тинты карточек, границы раскрытых строк. Никогда как цвет текста.
 */

export const CATEGORY_BG: Record<PortfolioCategory, string> = {
  btc: "bg-chart-btc",
  eth: "bg-chart-eth",
  stable: "bg-chart-stable",
};

export const CATEGORY_VAR: Record<PortfolioCategory, string> = {
  btc: "var(--chart-btc)",
  eth: "var(--chart-eth)",
  stable: "var(--chart-stable)",
};

/** Категорийный тинт карточки-метрики (ТЗ §5.1.3): 5% цвета поверх card. */
export function categoryTint(category: PortfolioCategory): string {
  return `color-mix(in oklab, ${CATEGORY_VAR[category]} 5%, var(--card))`;
}

/** Точка-маркер категории 8px. Подпись рядом — всегда обычный foreground. */
export function CategoryDot({
  category,
  className,
}: {
  category: PortfolioCategory;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        CATEGORY_BG[category],
        className,
      )}
    />
  );
}
