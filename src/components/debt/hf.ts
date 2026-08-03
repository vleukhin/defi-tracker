import { tableNumber } from "@/lib/format";

/**
 * Статус health factor относительно порога (Фаза 4, S4.3).
 * HF — главный индикатор фазы: ликвидация — единственный сценарий,
 * способный принудительно прервать стратегию накопления.
 *
 * Границы (порог по умолчанию 1.5):
 *  * below   — HF ниже порога: риск ликвидации, destructive;
 *  * warning — HF в буфере [порог; порог + 0.3): близко, warning;
 *  * ok      — HF ≥ порог + 0.3: спокойное состояние;
 *  * none    — долга нет (HF = uint256.max → null → «∞»).
 */

export type HfStatus = "ok" | "warning" | "below" | "none";

/** Буфер над порогом, ниже которого HF считается «близким к порогу». */
export const HF_OK_MARGIN = 0.3;

/** Допуск сравнения: порог + 0.3 в float может дать 1.8000…02. */
const EPSILON = 1e-9;

export function hfStatus(
  healthFactor: number | null,
  threshold: number,
): HfStatus {
  if (healthFactor === null) return "none";
  if (healthFactor < threshold - EPSILON) return "below";
  if (healthFactor < threshold + HF_OK_MARGIN - EPSILON) return "warning";
  return "ok";
}

/** «1,74» / «∞» — HF без переполнения поля (нет долга → null → «∞»). */
export function formatHf(healthFactor: number | null): string {
  return healthFactor === null ? "∞" : tableNumber(healthFactor, 2);
}

/** Цвет текста HF по статусу; знак не только цветом — рядом всегда число. */
export const HF_TEXT_CLASS: Record<HfStatus, string> = {
  ok: "text-success",
  warning: "text-warning",
  below: "text-destructive",
  none: "text-muted-foreground",
};

/**
 * Порог — всегда два знака: «1,50», «1,75», «2,00».
 *
 * Нули не срезаются намеренно: порог стоит в строке рядом с самим HF
 * и точкой ликвидации («HF 1,68 · порог 1,50 · ликвидация 1,00»), и три
 * числа разной точности в одной строке читаются как разные величины.
 */
export function formatHfThreshold(threshold: number): string {
  return tableNumber(threshold, 2);
}

/** Подсказка к HF-индикатору: словами, не только цветом. */
export function hfTitle(status: HfStatus, threshold: number): string {
  const t = formatHfThreshold(threshold);
  switch (status) {
    case "below":
      return `Health factor ниже порога ${t} — риск ликвидации`;
    case "warning":
      return `Health factor близок к порогу ${t}`;
    case "ok":
      return `Health factor выше порога ${t} с запасом`;
    case "none":
      return "Долга нет — health factor не ограничен";
  }
}

/** Единая подсказка «долг не читался» (null ≠ 0) — все экраны Фазы 4. */
export const DEBT_UNREAD_HINT = "долг еще не читался — нажмите Обновить";
