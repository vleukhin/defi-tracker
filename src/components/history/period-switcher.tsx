"use client";

import type { SnapshotPeriod } from "@/lib/api/types";

/**
 * Переключатель периода истории (S3.2). Тот же сегментированный контрол,
 * что и в фильтрах сделок; семантика — группа радиокнопок (fieldset +
 * legend + input[type=radio]), а не набор кнопок: выбирается одно из пяти.
 */

export const HISTORY_PERIODS: {
  key: SnapshotPeriod;
  /** Компактная подпись контрола. */
  label: string;
  /** Развернутое название — для тултипов, заголовков и aria-label графиков. */
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

/** Тот же сегментированный переключатель, что и в фильтрах сделок. */
const SEGMENT =
  "flex h-9 cursor-pointer select-none items-center justify-center gap-1.5 rounded-md border border-input px-2 text-sm transition-colors duration-120 ease-out hover:bg-accent/60 has-checked:border-ring has-checked:bg-accent has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

export function PeriodSwitcher({
  period,
  onChange,
}: {
  period: SnapshotPeriod;
  onChange: (period: SnapshotPeriod) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">Период истории</legend>
      <div className="grid grid-cols-5 gap-2">
        {HISTORY_PERIODS.map((p) => (
          <label key={p.key} className={SEGMENT} title={p.full}>
            <input
              type="radio"
              name="history-period"
              value={p.key}
              checked={period === p.key}
              onChange={() => onChange(p.key)}
              className="sr-only"
            />
            <span aria-hidden="true">{p.label}</span>
            <span className="sr-only">{p.full}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
