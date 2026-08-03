"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DcCard, SectionHead } from "@/components/dc/card";
import { formatHf, hfStatus } from "@/components/debt/hf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DebtResponseDto, SettingsDto } from "@/lib/api/types";
import { DEVIATION_THRESHOLD_PP, NBSP, tableNumber } from "@/lib/format";
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

function hfHint(debt: DebtResponseDto | null, threshold: number) {
  if (!debt) return null;
  const hf = debt.summary.minHealthFactor;
  if (hf === null) return <>долга нет — health factor не ограничен</>;
  const status = hfStatus(hf, threshold);
  const tone =
    status === "below"
      ? "text-loss"
      : status === "warning"
        ? "text-warn"
        : "text-text-2";
  const words =
    status === "below"
      ? "ниже порога"
      : status === "warning"
        ? "близко к порогу"
        : "выше порога";
  return (
    <>
      сейчас <span className={tone}>{formatHf(hf)}</span> — {words}
    </>
  );
}

export function AccountCard({ email }: { email: string | null }) {
  const { data, loading, refetch } = useApi<SettingsDto>("/api/settings");
  // Текущий HF для подсказки под порогом; только кэш, без RPC
  const { data: debt } = useApi<DebtResponseDto>("/api/debt");

  // null — поле не трогали: показывается сохранённое значение
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = data ? formatThreshold(data.hfWarningThreshold) : "";
  const value = draft ?? saved;
  const dirty = draft !== null && draft !== saved;

  function reset() {
    setDraft(null);
    setError(null);
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
      toast.success("Порог сохранён");
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
      <form onSubmit={save} className="border-line border-t">
        <div className="divide-y divide-line">
          <SettingRow label="Email">
            <span className="font-mono text-[13.5px]">{email ?? "—"}</span>
          </SettingRow>

          <SettingRow label="Тема">
            <ThemeRow />
          </SettingRow>

          <HfThresholdRow
            value={value}
            onChange={setDraft}
            disabled={loading && !data}
            invalid={error !== null}
            hint={data ? hfHint(debt, data.hfWarningThreshold) : null}
          />

          <SettingRow
            htmlFor="deviation-threshold"
            label="Порог отклонения от цели"
            hint="Отклонение доли актива от цели больше порога подсвечивается на странице «Цели». В этой версии порог фиксирован."
          >
            <Input
              id="deviation-threshold"
              type="text"
              inputMode="decimal"
              disabled
              value={tableNumber(DEVIATION_THRESHOLD_PP, 1)}
              className="w-[84px] border-line-strong text-right font-mono"
            />
            <span className="t-meta text-text-3">%</span>
          </SettingRow>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-line border-t px-card py-3.5">
          <Button type="submit" disabled={saving || !dirty}>
            {saving ? "Сохранение…" : "Сохранить"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={reset}
            disabled={saving || !dirty}
          >
            Отмена
          </Button>
          {error ? (
            <p role="alert" className="t-meta text-loss">
              {error}
            </p>
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
