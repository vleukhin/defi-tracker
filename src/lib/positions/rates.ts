import type { PositionDto } from "@/lib/api/types";
import { isStableSymbol } from "@/lib/stables";

/**
 * Ставка размещения и её спред к займу (docs/07 §3).
 *
 * Спред считается только для стейбл-размещений: ставка в ETH — про другой
 * риск и другую валюту, и правило «депозит держат, пока он дороже займа»
 * на неё не распространяется. У пулов ставки нет вовсе — доход там
 * считается по стоимости.
 *
 * Модуль чистый и лежит в lib, а не рядом с карточкой: те же два числа
 * нужны и ленте сигналов, и экрану «Долг», и карточке Fluid.
 */

/** Ставка позиции целиком: награды без базовой ставкой не являются. */
export function positionRate(position: PositionDto): number | null {
  const base = position.supplyRatePercent;
  return base === null ? null : base + (position.rewardsRatePercent ?? 0);
}

/** Спред к займу в п.п.; null = сравнивать не с чем или не с чем сравнивать. */
export function positionSpread(
  position: PositionDto,
  borrowRatePercent: number | null,
): number | null {
  const rate = positionRate(position);
  if (rate === null || borrowRatePercent === null) return null;
  if (!position.components.some((c) => isStableSymbol(c.symbol))) return null;
  return rate - borrowRatePercent;
}
