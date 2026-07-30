import { tablePctSigned, tableUsdSigned, usdDecimals } from "@/lib/format";

/**
 * Общее оформление P/L (Фаза 2, S2.2) для таблицы портфеля, карточек-метрик
 * и журнала сделок: знак всегда в тексте, цвет — только подкрепление.
 */

/** Цвет P/L по знаку; ноль — нейтральный. */
export function pnlClass(value: number): string {
  if (value > 0) return "text-success";
  if (value < 0) return "text-destructive";
  return "";
}

/** «+$1 234 (+5,2%)»; без процента (средняя 0 или нет цены) — только доллары. */
export function formatPnl(usd: number, pct: number | null): string {
  const body = tableUsdSigned(usd, usdDecimals(usd));
  return pct === null ? body : `${body} (${tablePctSigned(pct, 1)})`;
}
