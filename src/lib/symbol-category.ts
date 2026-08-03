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
  // Мостовые варианты пишутся суффиксом (как USDC.E в stables.ts).
  // WBTC.b — рынок BTC/USD у GMX на Arbitrum: без него BTC-пул терял
  // цель 70% и подписывался «рынок вне двух базовых активов».
  "WBTC.B",
  "WBTC.E",
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
  "WETH.E",
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
  if (category === "btc") return "var(--asset-btc)";
  if (category === "eth") return "var(--asset-eth)";
  if (category === "stable") return "var(--asset-stable)";
  // Токен вне трёх категорий: красить его категорийным цветом было бы враньём
  return "var(--text-3)";
}
