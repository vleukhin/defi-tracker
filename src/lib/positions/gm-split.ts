import type { PositionDto } from "@/lib/api/types";
import { symbolCategory } from "@/lib/symbol-category";

/**
 * Рабочий сплит внутри GM-пулов (docs/07 §8): 70% BTC/USDC и 30% ETH/USDC,
 * «как в портфеле».
 *
 * Пропорция задана самой стратегией, а не настройками: пока целевые сплиты
 * Yield в приложении не заводятся (§10.3), константа — честное отражение
 * документа. Появятся настройки — цель придет оттуда, а карточка не изменится.
 *
 * Считается по стоимости GM-пулов, а не по вложенному: доля — это то, чем
 * позиция является сейчас, а вложенное давно разошлось с текущей ценой.
 */
export const GM_TARGET_SHARE_PERCENT: Record<"btc" | "eth", number> = {
  btc: 70,
  eth: 30,
};

/** Отклонение, с которого доля считается требующей внимания (ТЗ §1.3). */
export const GM_SHARE_TOLERANCE_PP = 5;

export interface GmShare {
  /** Доля позиции в стоимости всех GM-пулов, %. null = стоимость неизвестна. */
  sharePercent: number | null;
  /** Цель по стратегии для этого рынка; null = рынок не BTC и не ETH. */
  targetPercent: number | null;
  /** Отклонение доли от цели в п.п.; null, если нет одной из величин. */
  deviationPp: number | null;
  /** Стоимость всех GM-пулов; null = хотя бы один не оценен. */
  totalUsd: number | null;
}

/**
 * Базовый актив GM-рынка — по long-компоненте: в паре BTC/USDC длинная
 * сторона и есть BTC. Короткая всегда стейбл и рынок не определяет.
 */
export function gmMarketCategory(position: PositionDto): "btc" | "eth" | null {
  const long = position.components.find((c) => c.side === "long");
  if (!long) return null;
  const category = symbolCategory(long.symbol);
  return category === "btc" || category === "eth" ? category : null;
}

export function gmShare(
  position: PositionDto,
  positions: PositionDto[],
): GmShare {
  const pools = positions.filter((p) => p.protocol === "gmx_v2");

  // Null-пропагация как везде: неоцененный пул делает неизвестной всю сумму,
  // а с ней и долю — доля от части пулов вводила бы в заблуждение
  let totalUsd: number | null = 0;
  for (const p of pools) {
    if (p.valueUsd === null || totalUsd === null) {
      totalUsd = null;
      break;
    }
    totalUsd += p.valueUsd;
  }

  const sharePercent =
    totalUsd !== null && totalUsd > 0 && position.valueUsd !== null
      ? (position.valueUsd / totalUsd) * 100
      : null;

  const category = gmMarketCategory(position);
  const targetPercent =
    category === null ? null : GM_TARGET_SHARE_PERCENT[category];

  return {
    sharePercent,
    targetPercent,
    deviationPp:
      sharePercent !== null && targetPercent !== null
        ? sharePercent - targetPercent
        : null,
    totalUsd,
  };
}
