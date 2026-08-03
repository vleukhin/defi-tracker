"use client";

import type { PositionDto, StrategyZone } from "@/lib/api/types";

/**
 * Общее для карточек позиций: подписи, цвета зон и тип правки разметки.
 * Живет отдельно от экрана — карточки протоколов лежат в своих файлах,
 * но говорят на одном языке.
 */

/** Подпись dt по ТЗ §2.2: 11px, uppercase, разреженная. */
export const LABEL =
  "text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase";

/**
 * Цвет зоны — собственный ряд, а не категорийный. Зоны и категории это
 * РАЗНЫЕ разрезы (docs/07 §10.1): категория отвечает «в чем лежит»,
 * зона — «какую задачу решает», и стейблы есть сразу в двух зонах.
 * Общий цвет склеивал бы два разреза в один и подсказывал бы неверное.
 *
 * Оттенки разведены с ближайшими соседями палитры (BTC-оранжевый,
 * success-зеленый, ETH-индиго) — см. ТЗ §1.3. Как и категорийные, эти
 * цвета только ЗАЛИВКА: точка, кромка, тинт, сегмент полосы. Не текст.
 */
export const ZONE_ACCENT: Record<StrategyZone, string> = {
  growth: "var(--color-zone-growth)",
  yield: "var(--color-zone-yield)",
  stability: "var(--color-zone-stability)",
};

/** Фон-тинт зоны: тот же рецепт, что у карточек протоколов (ТЗ §5.1.3). */
export function zoneTint(zone: StrategyZone, percent = 6): string {
  return `color-mix(in oklab, ${ZONE_ACCENT[zone]} ${percent}%, var(--card))`;
}

export const ZONE_OPTIONS: { value: StrategyZone; label: string }[] = [
  { value: "growth", label: "Growth" },
  { value: "yield", label: "Yield" },
  { value: "stability", label: "Stability" },
];

/** Что можно поправить у позиции за один запрос. */
export interface MarkPatch {
  zone?: StrategyZone;
  ownPrincipalUsd?: number | null;
  borrowedPrincipalUsd?: number | null;
  withdrawnUsd?: number | null;
}

/** Сохранение разметки; true = сохранилось (форма по этому признаку закрывается). */
export type MarkFn = (
  position: PositionDto,
  patch: MarkPatch,
) => Promise<boolean>;

/** Зона позиции: точка цвета зоны + название. */
export function ZoneChip({ zone }: { zone: StrategyZone }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: ZONE_ACCENT[zone] }}
      />
      {ZONE_OPTIONS.find((o) => o.value === zone)?.label ?? zone}
    </span>
  );
}
