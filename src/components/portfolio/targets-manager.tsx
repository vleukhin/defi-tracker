"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  ManualListDto,
  PortfolioCategory,
  TargetsResponseDto,
} from "@/lib/api/types";
import { NBSP, formatQuantity, tableUsd } from "@/lib/format";
import { ApiError, apiFetch } from "@/lib/use-api";

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

type Notice = { kind: "ok" | "warn" | "error"; text: string } | null;

export function TargetsManager() {
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [savedSum, setSavedSum] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
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
    setNotice(null);
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
      setNotice(
        res.warning
          ? { kind: "warn", text: `Сохранено. ${res.warning}` }
          : { kind: "ok", text: "Цели сохранены" },
      );
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof ApiError ? err.message : "Не удалось сохранить",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={saveTargets}
        className="rounded-lg border border-gray-200 bg-white p-4"
      >
        <h2 className="text-sm font-medium text-gray-700">Целевые проценты</h2>
        <p className="mt-1 text-xs text-gray-500">
          Портфель состоит из трех частей. Пустое поле — цель не задана.
        </p>

        <div className="mt-3 divide-y divide-gray-100">
          {CATEGORIES.map((c) => (
            <div
              key={c.key}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <label
                htmlFor={`target-${c.key}`}
                className="text-sm text-gray-900"
              >
                {c.label}
              </label>
              <div className="flex items-center gap-1.5">
                <input
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
                  className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>
          ))}
        </div>

        <p
          className={`mt-3 rounded-md px-3 py-2 text-sm ${
            sumIs100
              ? "bg-emerald-50 text-emerald-800"
              : "bg-amber-50 text-amber-800"
          }`}
          role="status"
        >
          {sumIs100
            ? "Сумма: 100%"
            : `Сумма: ${sum}%${NBSP}— отклонения будут считаться от заданных целей`}
        </p>

        {notice && (
          <p
            className={`mt-2 rounded-md px-3 py-2 text-sm ${
              notice.kind === "ok"
                ? "bg-emerald-50 text-emerald-800"
                : notice.kind === "warn"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-red-50 text-red-700"
            }`}
            role="status"
          >
            {notice.text}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="mt-3 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? "Сохранение…" : "Сохранить цели"}
        </button>
        {savedSum !== null && savedSum === 0 && (
          <p className="mt-2 text-xs text-gray-400">
            Пока цели не заданы — отклонения не рассчитываются.
          </p>
        )}
      </form>

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить");
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-gray-700">
            {label} — вручную
          </h2>
          {entries.length > 0 && (
            <span className="text-sm tabular-nums text-gray-600">
              {unit === "USD"
                ? tableUsd(total)
                : `${formatQuantity(String(total))} ${unit}`}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
      </div>

      <form onSubmit={add} className="flex flex-col gap-2 px-4 py-3 sm:flex-row">
        <input
          type="text"
          required
          maxLength={60}
          value={entryLabel}
          onChange={(e) => setEntryLabel(e.target.value)}
          placeholder={unit === "USD" ? "GMX пул" : "Биржа, холодный кошелек"}
          aria-label={`Подпись записи ${label}`}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          type="text"
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={unit === "USD" ? "15000" : "0.5"}
          aria-label={`Количество (${unit})`}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-right text-sm tabular-nums sm:w-32"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {pending ? "…" : "Добавить"}
        </button>
      </form>

      {error && (
        <p className="px-4 pb-2 text-sm text-red-700" role="status">
          {error}
        </p>
      )}

      {loading ? (
        <p className="px-4 pb-3 text-sm text-gray-400">Загрузка…</p>
      ) : entries.length === 0 ? (
        <p className="px-4 pb-3 text-sm text-gray-400">Записей пока нет.</p>
      ) : (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-2 px-4 py-2.5"
            >
              <span className="min-w-0 truncate text-sm text-gray-900">
                {e.label}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-sm tabular-nums text-gray-600">
                  {formatQuantity(e.amount)}
                  <span className="ml-1 text-xs text-gray-400">{unit}</span>
                </span>
                <button
                  onClick={() => void remove(e.id)}
                  aria-label={`Удалить запись ${e.label}`}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                >
                  Удалить
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
