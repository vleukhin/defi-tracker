import type { PortfolioCategory } from "@/lib/api/types";
import { isStableSymbol } from "@/lib/stables";

/**
 * Категория портфеля по символу токена — BTC / ETH / стейбл.
 *
 * Нужна там, где состав позиции показывается цветом: пара WETH/USDC читается
 * быстрее, если ее доли покрашены тем же языком, что и категории портфеля
 * (ТЗ §1.3). Курируемый список залога (chains/aave.ts) для этого не годится:
 * он помечен "server-only" и покрывает только резервы Aave, а в пуле лежит
 * что угодно.
 *
 * null = токен не отнесен ни к одной категории. Это не ошибка: в пуле
 * встречаются токены, которые портфель не ведет, — красить их категорийным
 * цветом было бы враньем.
 */

const BTC_SYMBOLS = new Set([
  "BTC",
  "WBTC",
  "CBBTC",
  "TBTC",
  "LBTC",
  "EBTC",
  "FBTC",
  "SOLVBTC",
  "BTCB",
]);

const ETH_SYMBOLS = new Set([
  "ETH",
  "WETH",
  "STETH",
  "WSTETH",
  "WEETH",
  "EETH",
  "RETH",
  "CBETH",
  "OSETH",
  "ETHX",
  "RSETH",
  "WRSETH",
  "EZETH",
  "TETH",
]);

export function symbolCategory(symbol: string): PortfolioCategory | null {
  const upper = symbol.toUpperCase();
  if (BTC_SYMBOLS.has(upper)) return "btc";
  if (ETH_SYMBOLS.has(upper)) return "eth";
  if (isStableSymbol(upper)) return "stable";
  return null;
}

/** Цвет категории — только заливкой (точки, сегменты полос), не текстом. */
export function categoryColor(symbol: string): string {
  const category = symbolCategory(symbol);
  if (category === "btc") return "var(--color-chart-btc)";
  if (category === "eth") return "var(--color-chart-eth)";
  if (category === "stable") return "var(--color-chart-stable)";
  return "var(--color-muted-foreground)";
}
