"use client";

import { ZONE_LABEL, zoneColor } from "@/components/dc/chip";
import type { PositionDto, StrategyZone } from "@/lib/api/types";

/**
 * Общее для карточек позиций: тип правки разметки и список зон.
 * Живёт отдельно от экрана — карточки протоколов лежат в своих файлах,
 * но говорят на одном языке.
 *
 * Цвета и подписи зон берутся из примитивов дизайн-кода
 * (`@/components/dc/chip`): один список зон на приложение, а не по копии
 * на экран.
 */

export const ZONE_OPTIONS: { value: StrategyZone; label: string }[] = (
  ["growth", "yield", "stability"] as const
).map((zone) => ({ value: zone, label: ZONE_LABEL[zone] }));

/**
 * Цвет зоны — заливка, точка, кромка; текст красится `zoneTextColor`.
 * Зоны и категории это РАЗНЫЕ разрезы (docs/07 §10.1): категория отвечает
 * «в чём лежит», зона — «какую задачу решает», и стейблы есть сразу в двух
 * зонах. Ни зелёного, ни красного среди этих оттенков нет: семантика
 * P/L не должна путаться с разрезом стратегии.
 */
export const ZONE_ACCENT: Record<StrategyZone, string> = {
  growth: zoneColor("growth"),
  yield: zoneColor("yield"),
  stability: zoneColor("stability"),
};

/** Заливка чипа/кнопки зоны: тот же рецепт 10%, что у ZoneChip. */
export function zoneTint(zone: StrategyZone, percent = 10): string {
  return `color-mix(in srgb, ${ZONE_ACCENT[zone]} ${percent}%, transparent)`;
}

/** Что можно поправить у позиции за один запрос. */
export interface MarkPatch {
  zone?: StrategyZone;
  ownPrincipalUsd?: number | null;
  borrowedPrincipalUsd?: number | null;
  withdrawnUsd?: number | null;
  /** Точка отсчёта уровней падения — цена базового актива на входе. */
  entryPriceUsd?: number | null;
}

/** Сохранение разметки; true = сохранилось (форма по этому признаку закрывается). */
export type MarkFn = (
  position: PositionDto,
  patch: MarkPatch,
) => Promise<boolean>;
