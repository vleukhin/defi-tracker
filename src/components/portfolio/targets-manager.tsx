"use client";

import { TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ManualListDto,
  PortfolioCategory,
  TargetsResponseDto,
} from "@/lib/api/types";
import { NBSP, formatQuantity, tableUsd } from "@/lib/format";
import { ApiError, apiFetch } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { CATEGORY_BG, CategoryDot } from "./category";

/**
 * Цели (S1.6) и ручные записи (S1.4) на одном экране.
 *
 * Категории фиксированы: BTC, ETH, Stablecoins. Стейблы вносятся в USD,
 * BTC/ETH — в монетах (корректировка к залогу из лендинга).
 */

const CATEGORIES: { key: PortfolioCategory; label: string; unit: string; hint: string }[] = [
  {
    key: "btc",
    label: "BTC",
    unit: "BTC",
    hint: "Залог в лендинге читается автоматически. Здесь — монеты вне лендинга: биржа, холодный кошелек.",
  },
  {
    key: "eth",
    label: "ETH",
    unit: "ETH",
    hint: "Залог в лендинге читается автоматически. Здесь — монеты вне лендинга.",
  },
  {
    key: "stable",
    label: "Stablecoins",
    unit: "USD",
    hint: "Проинвестированные стейблкоины — суммы в долларах с подписью, где они лежат.",
  },
];

export function TargetsManager() {
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [savedSum, setSavedSum] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ManualListDto["entries"] | null>(null);

  const loadTargets = useCallback(() => {
    apiFetch<TargetsResponseDto>("/api/portfolio/targets")
      .then((res) => {
        const next: Record<string, string> = {};
        for (const t of res.targets) next[t.category] = String(t.targetPct);
        setTargets(next);
        setSavedSum(res.sumPct);
      })
      .catch(() => setSavedSum(0));
  }, []);

  const loadEntries = useCallback(() => {
    apiFetch<ManualListDto>("/api/portfolio/manual")
      .then((res) => setEntries(res.entries))
      .catch(() => setEntries([]));
  }, []);

  useEffect(() => {
    loadTargets();
    loadEntries();
  }, [loadTargets, loadEntries]);

  const sum =
    Math.round(
      CATEGORIES.reduce((acc, c) => {
        const n = Number.parseFloat(targets[c.key] ?? "");
        return acc + (Number.isFinite(n) ? n : 0);
      }, 0) * 1000,
    ) / 1000;
  const sumIs100 = Math.abs(sum - 100) < 0.001;

  async function saveTargets(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const payload = CATEGORIES.flatMap((c) => {
        const raw = (targets[c.key] ?? "").trim();
        if (raw === "") return [];
        const n = Number.parseFloat(raw.replace(",", "."));
        return Number.isFinite(n) ? [{ category: c.key, targetPct: n }] : [];
      });
      const res = await apiFetch<TargetsResponseDto>("/api/portfolio/targets", {
        method: "PUT",
        body: JSON.stringify({ targets: payload }),
      });
      setSavedSum(res.sumPct);
      // Успех — тостом; предупреждение о сумме ≠ 100% — вместе с ним (§5.3)
      if (res.warning) {
        toast.warning(`Сохранено. ${res.warning}`);
      } else {
        toast.success("Цели сохранены");
      }
    } catch (err) {
      // Ошибка — инлайн: должна остаться на экране (§5.3)
      setSaveError(
        err instanceof ApiError ? err.message : "Не удалось сохранить",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form onSubmit={saveTargets}>
          <h2 className="text-sm font-semibold">Целевые проценты</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Портфель состоит из трех частей. Пустое поле — цель не задана.
          </p>

          <div className="mt-3 divide-y divide-border">
            {CATEGORIES.map((c) => (
              <div
                key={c.key}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <Label
                  htmlFor={`target-${c.key}`}
                  className="gap-2 font-normal"
                >
                  <CategoryDot category={c.key} />
                  {c.label}
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id={`target-${c.key}`}
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    inputMode="decimal"
                    value={targets[c.key] ?? ""}
                    onChange={(e) =>
                      setTargets((prev) => ({ ...prev, [c.key]: e.target.value }))
                    }
                    placeholder="—"
                    className="w-24 text-right font-mono"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Живой индикатор суммы (S1.6): предупреждение, не блокировка */}
          <div role="status" className="mt-3">
            {sumIs100 ? (
              <div className="space-y-2">
                <p className="text-sm text-success">Сумма: 100%</p>
                {/* Мини-превью полосы: будущая аллокация до сохранения (§5.3) */}
                <div className="flex h-1.5 gap-0.5">
                  {CATEGORIES.map((c) => {
                    const pct = Number.parseFloat(targets[c.key] ?? "");
                    if (!Number.isFinite(pct) || pct <= 0) return null;
                    return (
                      <div
                        key={c.key}
                        className={cn(
                          "h-full transition-[width] duration-400 ease-out first:rounded-l-full last:rounded-r-full",
                          CATEGORY_BG[c.key],
                        )}
                        style={{
                          width: `${pct}%`,
                          minWidth: pct < 1 ? "4px" : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <Alert variant="warning" className="py-2">
                <TriangleAlert className="size-4" />
                <AlertTitle className="font-normal">
                  Сумма: <span className="font-mono">{sum}%</span>
                  {NBSP}— отклонения будут считаться от заданных целей
                </AlertTitle>
              </Alert>
            )}
          </div>

          {saveError && (
            <p role="status" className="mt-2 text-sm text-destructive">
              {saveError}
            </p>
          )}

          <Button type="submit" disabled={saving} className="mt-3">
            {saving ? "Сохранение…" : "Сохранить цели"}
          </Button>
          {savedSum !== null && savedSum === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Пока цели не заданы — отклонения не рассчитываются.
            </p>
          )}
        </form>
      </Card>

      {CATEGORIES.map((c) => (
        <ManualSection
          key={c.key}
          category={c.key}
          label={c.label}
          unit={c.unit}
          hint={c.hint}
          entries={(entries ?? []).filter((e) => e.category === c.key)}
          loading={entries === null}
          onChanged={loadEntries}
        />
      ))}
    </div>
  );
}

function ManualSection({
  category,
  label,
  unit,
  hint,
  entries,
  loading,
  onChanged,
}: {
  category: PortfolioCategory;
  label: string;
  unit: string;
  hint: string;
  entries: ManualListDto["entries"];
  loading: boolean;
  onChanged: () => void;
}) {
  const [entryLabel, setEntryLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = entries.reduce(
    (acc, e) => acc + (Number.parseFloat(e.amount) || 0),
    0,
  );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiFetch("/api/portfolio/manual", {
        method: "POST",
        body: JSON.stringify({ category, label: entryLabel, amount }),
      });
      setEntryLabel("");
      setAmount("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось добавить");
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiFetch(`/api/portfolio/manual/${id}`, { method: "DELETE" });
      onChanged();
      toast.success("Запись удалена");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить");
    }
  }

  return (
    <Card className="p-0">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CategoryDot category={category} />
            {label} — вручную
          </h2>
          {entries.length > 0 && (
            <span className="font-mono text-sm text-muted-foreground">
              {unit === "USD"
                ? tableUsd(total)
                : `${formatQuantity(String(total))} ${unit}`}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>

      <form onSubmit={add} className="flex flex-col gap-2 px-4 py-3 sm:flex-row">
        <Input
          type="text"
          required
          maxLength={60}
          value={entryLabel}
          onChange={(e) => setEntryLabel(e.target.value)}
          placeholder={unit === "USD" ? "GMX пул" : "Биржа, холодный кошелек"}
          aria-label={`Подпись записи ${label}`}
          className="flex-1"
        />
        <Input
          type="text"
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={unit === "USD" ? "15000" : "0.5"}
          aria-label={`Количество (${unit})`}
          className="w-full text-right font-mono sm:w-32"
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "…" : "Добавить"}
        </Button>
      </form>

      {error && (
        <p className="px-4 pb-2 text-sm text-destructive" role="status">
          {error}
        </p>
      )}

      {loading ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">Загрузка…</p>
      ) : entries.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          Записей пока нет.
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-2 px-4 py-2.5"
            >
              <span className="min-w-0 truncate text-sm">{e.label}</span>
              <span className="flex items-center gap-3">
                <span className="font-mono text-sm">
                  {formatQuantity(e.amount)}
                  <span className="ml-1 font-sans text-xs text-muted-foreground">
                    {unit}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void remove(e.id)}
                  aria-label={`Удалить запись ${e.label}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="size-4" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
