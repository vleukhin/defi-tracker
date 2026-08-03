"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { SettingRow } from "./setting-row";

/**
 * Строка «Порог предупреждения HF» (Фаза 4, S4.1/S4.3): ниже порога
 * дашборд и экран «Долг» показывают предупреждение о риске ликвидации.
 *
 * Поле управляемое, сохранение — общей кнопкой карточки (README §9):
 * две кнопки «Сохранить» в одной карточке читались бы как два разных
 * действия. Разделитель дробной части — запятая (дизайн-код §4), поэтому
 * поле текстовое: type="number" запятую не принимает.
 */

/** Границы формы. Сервер требует строго >1; верх — договорённость дизайна. */
export const HF_MIN = 1;
export const HF_MAX = 3;

export function HfThresholdRow({
  value,
  onChange,
  hint,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  /** «сейчас 1,68 — выше порога»; null, пока долг не прочитан. */
  hint?: ReactNode;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <SettingRow
      htmlFor="hf-threshold"
      label="Порог предупреждения HF"
      hint="Когда health factor опускается ниже порога, портфель и страница «Долг» предупреждают о риске ликвидации."
    >
      <Input
        id="hf-threshold"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={hint ? "hf-threshold-hint" : undefined}
        className="w-[84px] border-line-strong text-right font-mono"
      />
      {hint && (
        <span id="hf-threshold-hint" className="t-meta text-text-3">
          {hint}
        </span>
      )}
    </SettingRow>
  );
}
