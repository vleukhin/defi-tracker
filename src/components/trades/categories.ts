import type { PortfolioCategory } from "@/lib/api/types";

/**
 * Три фиксированные категории портфеля в порядке таблицы (S2.1).
 * Локальная копия для клиентских компонентов — lib/portfolio импортирует
 * серверные модули и в бандл страницы не тянется.
 */
export const TRADE_CATEGORIES: {
  key: PortfolioCategory;
  label: string;
  /** Единица количества сделки: BTC / ETH / USD. */
  unit: string;
}[] = [
  { key: "btc", label: "BTC", unit: "BTC" },
  { key: "eth", label: "ETH", unit: "ETH" },
  { key: "stable", label: "Stablecoins", unit: "USD" },
];

export const CATEGORY_LABEL: Record<PortfolioCategory, string> =
  Object.fromEntries(
    TRADE_CATEGORIES.map((c) => [c.key, c.label]),
  ) as Record<PortfolioCategory, string>;

export const CATEGORY_UNIT: Record<PortfolioCategory, string> =
  Object.fromEntries(TRADE_CATEGORIES.map((c) => [c.key, c.unit])) as Record<
    PortfolioCategory,
    string
  >;
