"use client";

import { Segmented } from "@/components/dc/segmented";
import type { SnapshotPeriod } from "@/lib/api/types";

/**
 * Переключатель периода истории (README, экран 5) — тот же сегментированный
 * контрол дизайн-кода, что «Категории / Зоны» на портфеле: это один набор
 * данных в другом разрезе, а не навигация.
 */

export const HISTORY_PERIODS: {
  key: SnapshotPeriod;
  /** Компактная подпись контрола. */
  label: string;
  /** Развёрнутое название — для aria-label графиков и подписей карточек. */
  full: string;
}[] = [
  { key: "7d", label: "7д", full: "7 дней" },
  { key: "30d", label: "30д", full: "30 дней" },
  { key: "90d", label: "90д", full: "90 дней" },
  { key: "1y", label: "1г", full: "год" },
  { key: "all", label: "всё", full: "все время" },
];

export function periodFull(period: SnapshotPeriod): string {
  return HISTORY_PERIODS.find((p) => p.key === period)?.full ?? period;
}

export function PeriodSwitcher({
  period,
  onChange,
}: {
  period: SnapshotPeriod;
  onChange: (period: SnapshotPeriod) => void;
}) {
  return (
    <Segmented
      ariaLabel="Период истории"
      value={period}
      onChange={onChange}
      options={HISTORY_PERIODS.map((p) => ({
        value: p.key,
        label: (
          <>
            <span aria-hidden>{p.label}</span>
            <span className="sr-only">{p.full}</span>
          </>
        ),
      }))}
    />
  );
}
