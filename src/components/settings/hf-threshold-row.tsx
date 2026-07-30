"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatHfThreshold } from "@/components/debt/hf";
import type { SettingsDto } from "@/lib/api/types";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";

/**
 * Строка настроек «Порог предупреждения HF» (Фаза 4, S4.1/S4.3):
 * ниже порога дашборд и экран «Долг» показывают предупреждение о риске
 * ликвидации. Границы формы повторяют серверные (1 < x ≤ 10, дефолт 1.5).
 */

export function HfThresholdRow() {
  const { data, loading, refetch } = useApi<SettingsDto>("/api/settings");
  // null — пользователь еще не трогал поле: показывается сохраненное
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = draft ?? (data ? String(data.hfWarningThreshold) : "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = Number.parseFloat(value.replace(",", "."));
    if (!Number.isFinite(n) || n <= 1 || n > 10) {
      setError("Порог — число больше 1 и не больше 10");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch<SettingsDto>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ hfWarningThreshold: n }),
      });
      toast.success("Порог сохранен");
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
    <div className="px-4 py-3">
      <Label
        htmlFor="hf-threshold"
        className="text-xs font-normal text-muted-foreground"
      >
        Порог предупреждения HF
      </Label>
      <form onSubmit={save} className="mt-1.5 flex items-center gap-2">
        <Input
          id="hf-threshold"
          type="number"
          min={1.1}
          max={10}
          step={0.1}
          inputMode="decimal"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          disabled={loading && !data}
          className="w-24 text-right font-mono"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
      </form>
      {error && (
        <p role="status" className="mt-1.5 text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="mt-1.5 text-xs text-muted-foreground">
        {data !== null && (
          <>
            Текущий порог:{" "}
            <span className="font-mono">
              {formatHfThreshold(data.hfWarningThreshold)}
            </span>
            .{" "}
          </>
        )}
        Когда health factor опускается ниже порога, дашборд и экран «Долг»
        предупреждают о риске ликвидации.
      </p>
    </div>
  );
}
