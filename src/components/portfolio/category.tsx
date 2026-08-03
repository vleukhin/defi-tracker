import type { PortfolioCategory } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Цвета категорий активов — «в чём лежит капитал» (дизайн-код §2, роль
 * «данные»). Только заливки: точки, сегменты полос, кромки карточек.
 * Семантику (profit/loss) им не отдают и наоборот: цвет актива, спутанный
 * с цветом прибыли, — главная ошибка старого интерфейса.
 */

/**
 * Единственный клиентский источник подписей категорий. Раньше их было
 * четыре — «Сделки» звали третью категорию «Stablecoins», «История»
 * и «Цели» «Стейблы», — и одна и та же строка портфеля называлась
 * на соседних экранах по-разному.
 *
 * Копия, а не импорт из lib/portfolio: тот модуль тянет серверные
 * зависимости и в бандл страницы не идёт. Значения обязаны совпадать
 * с `CATEGORY_LABELS` там — сервер шлёт `row.label` уже готовым.
 */
export const CATEGORIES: {
  key: PortfolioCategory;
  label: string;
  /** Единица количества: BTC / ETH / USD. */
  unit: string;
}[] = [
  { key: "btc", label: "BTC", unit: "BTC" },
  { key: "eth", label: "ETH", unit: "ETH" },
  { key: "stable", label: "Стейблы", unit: "USD" },
];

export const CATEGORY_LABEL: Record<PortfolioCategory, string> =
  Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])) as Record<
    PortfolioCategory,
    string
  >;

export const CATEGORY_UNIT: Record<PortfolioCategory, string> =
  Object.fromEntries(CATEGORIES.map((c) => [c.key, c.unit])) as Record<
    PortfolioCategory,
    string
  >;

export const CATEGORY_BG: Record<PortfolioCategory, string> = {
  btc: "bg-asset-btc",
  eth: "bg-asset-eth",
  stable: "bg-asset-stable",
};

export const CATEGORY_VAR: Record<PortfolioCategory, string> = {
  btc: "var(--asset-btc)",
  eth: "var(--asset-eth)",
  stable: "var(--asset-stable)",
};

/** Категорийный тинт карточки: 5% цвета поверх поверхности. */
export function categoryTint(category: PortfolioCategory): string {
  return `color-mix(in oklab, ${CATEGORY_VAR[category]} 5%, var(--card))`;
}

/**
 * Текстовый оттенок категории — для процента внутри сегмента полосы.
 * У зон такой оттенок задан токеном (`--zone-*-text`), у активов его нет,
 * поэтому он выводится из самого цвета сдвигом к цвету текста: на тёмной
 * теме получается светлее, на светлой — темнее, и контраст держится в обеих.
 */
export function assetTextColor(category: PortfolioCategory): string {
  return `color-mix(in srgb, ${CATEGORY_VAR[category]} 70%, var(--text-1))`;
}

/** Точка-маркер категории. Подпись рядом — всегда обычный текст. */
export function CategoryDot({
  category,
  size,
  className,
}: {
  category: PortfolioCategory;
  /** По умолчанию 8px; в карточках и легендах дизайн-кода — 7px и 6px. */
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 rounded-full",
        size === undefined && "size-2",
        CATEGORY_BG[category],
        className,
      )}
      style={size === undefined ? undefined : { width: size, height: size }}
    />
  );
}
