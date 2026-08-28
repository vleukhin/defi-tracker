"use client";

import { useState } from "react";
import { DcCard, SectionHead } from "@/components/dc/card";
import { Chip } from "@/components/dc/chip";
import { formatHf } from "@/components/debt/hf";
import { hfTone } from "@/components/debt/risk";
import { Button } from "@/components/ui/button";
import type { DebtResponseDto, SettingsDto } from "@/lib/api/types";
import { DEVIATION_THRESHOLD_PP, NBSP, tableNumber } from "@/lib/format";
import { HF_ZONE_LABEL, hfZone } from "@/lib/hf-zones";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { HF_MAX, HF_MIN, HfThresholdRow } from "./hf-threshold-row";
import { SettingRow } from "./setting-row";
import { ThemeRow } from "./theme-row";

/**
 * Карточка «Аккаунт и вид» (README §9): email, тема и пороги
 * предупреждений. Тема применяется сразу (это вид, а не данные), пороги —
 * по «Сохранить»: единственная primary-кнопка экрана.
 */

/** «1,50» — порог всегда с двумя знаками, как в дизайне. */
function formatThreshold(value: number): string {
  return tableNumber(value, 2);
}

/**
 * Подсказка под порогом: текущий HF цветом и зоной словами.
 *
 * Цвет — общий hfTone, названия зон — общий HF_ZONE_LABEL: те же, что уходят
 * в телеграм. Собственная тройка «выше / близко / ниже» здесь красила HF 1,40
 * при пороге 1,50 в красный, тогда как «Долг» тем же числом рисовал жёлтый.
 */
function hfHint(debt: DebtResponseDto | null, threshold: number) {
  if (!debt) return null;
  const hf = debt.summary.minHealthFactor;
  if (hf === null) return <>долга нет — health factor не ограничен</>;
  const tone = hfTone(hf, threshold);
  const toneClass =
    tone === "loss" ? "text-loss" : tone === "warn" ? "text-warn" : "text-text-2";
  return (
    <>
      сейчас <span className={toneClass}>{formatHf(hf)}</span> —{" "}
      {HF_ZONE_LABEL[hfZone(hf, threshold)]}
    </>
  );
}

export function AccountCard({ email }: { email: string | null }) {
  const {
    data,
    error: loadError,
    loading,
    refetch,
  } = useApi<SettingsDto>("/api/settings");
  // Текущий HF для подсказки под порогом; только кэш, без RPC
  const { data: debt } = useApi<DebtResponseDto>("/api/debt");

  // null — поле не трогали: показывается сохранённое значение
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const saved = data ? formatThreshold(data.hfWarningThreshold) : "";
  const value = draft ?? saved;
  const dirty = draft !== null && draft !== saved;

  function reset() {
    setDraft(null);
    setError(null);
    setSavedNotice(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = Number.parseFloat(value.replace(",", "."));
    if (!Number.isFinite(n) || n <= HF_MIN || n > HF_MAX) {
      setError(
        `Порог — число больше ${formatThreshold(HF_MIN)} и не больше ${formatThreshold(HF_MAX)}`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch<SettingsDto>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ hfWarningThreshold: n }),
      });
      setSavedNotice(true);
      setDraft(null);
      await refetch();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Не удалось сохранить порог",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <DcCard as="section">
      <SectionHead title="Аккаунт и вид" />
      {loadError !== null && data === null && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border-line border-t px-card py-3 text-[13px] text-loss"
        >
          <span>Не удалось загрузить настройки: {loadError}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void refetch()}
          >
            {loading ? "Загрузка…" : "Повторить"}
          </Button>
        </div>
      )}
      <form onSubmit={save} className="border-line border-t">
        <div className="divide-y divide-line">
          <SettingRow label="Email">
            <span className="min-w-0 break-all text-[13.5px]">{email ?? "—"}</span>
          </SettingRow>

          <SettingRow label="Тема">
            <ThemeRow />
          </SettingRow>

          <HfThresholdRow
            value={value}
            onChange={(next) => {
              setDraft(next);
              setSavedNotice(false);
            }}
            disabled={loading && !data}
            invalid={error !== null}
            hint={data ? hfHint(debt, data.hfWarningThreshold) : null}
          />

          <SettingRow
            htmlFor="deviation-threshold"
            label="Порог отклонения от цели"
            hint="Отклонение доли актива от цели больше порога подсвечивается на странице «Цели». В этой версии порог фиксирован."
          >
            <Chip>{tableNumber(DEVIATION_THRESHOLD_PP, 1)}%</Chip>
            <span className="t-meta text-text-3">фиксировано в этой версии</span>
          </SettingRow>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-line border-t px-card py-3.5">
          <Button type="submit" disabled={saving || !dirty}>
            {saving ? "Сохранение…" : "Сохранить порог"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={reset}
            disabled={saving || !dirty}
          >
            Сбросить изменение
          </Button>
          {error ? (
            <p role="alert" className="t-meta text-loss">
              {error}
            </p>
          ) : savedNotice ? (
            <span role="status" aria-live="polite" className="t-meta text-profit">
              Сохранено: порог {saved}
            </span>
          ) : (
            <span className="t-meta text-text-3">
              Тема применяется сразу, пороги{NBSP}—{NBSP}по «Сохранить».
            </span>
          )}
        </div>
      </form>
    </DcCard>
  );
}
