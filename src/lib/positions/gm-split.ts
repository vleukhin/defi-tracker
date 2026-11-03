import type { PositionDto } from "@/lib/api/types";
import { symbolCategory } from "@/lib/symbol-category";
import { gmBaseComponent } from "./gm-asset";

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
 *
 * Сравнивается с целью доля БАЗОВОГО АКТИВА, а не доля одного пула. Цель
 * стратегии — про то, сколько денег Yield стоит в BTC и сколько в ETH, и у
 * одного актива пулов бывает несколько: BTC/USDC рядом с одноактивным
 * BTC/USD [BTC-BTC]. Сравнение каждого пула с 70% в такой расстановке
 * показывало бы перекос, которого нет. Когда на актив приходится по одному
 * пулу, обе доли совпадают, и число на карточке не меняется.
 */
export const GM_TARGET_SHARE_PERCENT: Record<"btc" | "eth", number> = {
  btc: 70,
  eth: 30,
};

/** Отклонение, с которого доля считается требующей внимания (ТЗ §1.3). */
export const GM_SHARE_TOLERANCE_PP = 5;

export interface GmShare {
  /** Доля ЭТОГО пула в стоимости всех GM-пулов, %. null = неизвестна. */
  poolSharePercent: number | null;
  /**
   * Доля всех пулов того же базового актива — её и сравнивают с целью.
   * null = рынок не BTC и не ETH либо стоимость неизвестна.
   */
  categorySharePercent: number | null;
  /**
   * Сколько пулов приходится на этот базовый актив, включая текущий.
   * У рынка вне BTC и ETH — ноль: доли по активу у него нет вовсе.
   */
  categoryPools: number;
  /** Цель по стратегии для этого рынка; null = рынок не BTC и не ETH. */
  targetPercent: number | null;
  /** Отклонение доли АКТИВА от цели в п.п.; null, если нет одной из величин. */
  deviationPp: number | null;
  /** Стоимость всех GM-пулов; null = хотя бы один не оценен. */
  totalUsd: number | null;
}

/**
 * Базовый актив GM-рынка — по его компоненте (positions/gm-asset.ts): в паре
 * BTC/USDC это длинная сторона, у одноактивного рынка — единственный
 * компонент. Короткая сторона всегда стейбл и рынок не определяет.
 */
export function gmMarketCategory(position: PositionDto): "btc" | "eth" | null {
  const base = gmBaseComponent(position);
  if (!base) return null;
  const category = symbolCategory(base.symbol);
  return category === "btc" || category === "eth" ? category : null;
}

/** Сумма стоимостей с null-пропагацией: неоценённый пул = сумма неизвестна. */
function totalOrNull(pools: PositionDto[]): number | null {
  let total = 0;
  for (const p of pools) {
    if (p.valueUsd === null) return null;
    total += p.valueUsd;
  }
  return total;
}

export function gmShare(
  position: PositionDto,
  positions: PositionDto[],
): GmShare {
  const pools = positions.filter((p) => p.protocol === "gmx_v2");
  const category = gmMarketCategory(position);
  const samePools =
    category === null
      ? []
      : pools.filter((p) => gmMarketCategory(p) === category);

  // Null-пропагация как везде: неоцененный пул делает неизвестной всю сумму,
  // а с ней и долю — доля от части пулов вводила бы в заблуждение
  const totalUsd = totalOrNull(pools);
  const categoryUsd = category === null ? null : totalOrNull(samePools);

  const share = (partUsd: number | null): number | null =>
    totalUsd !== null && totalUsd > 0 && partUsd !== null
      ? (partUsd / totalUsd) * 100
      : null;

  const poolSharePercent = share(position.valueUsd);
  const categorySharePercent = share(categoryUsd);
  const targetPercent =
    category === null ? null : GM_TARGET_SHARE_PERCENT[category];

  return {
    poolSharePercent,
    categorySharePercent,
    categoryPools: samePools.length,
    targetPercent,
    deviationPp:
      categorySharePercent !== null && targetPercent !== null
        ? categorySharePercent - targetPercent
        : null,
    totalUsd,
  };
}
