"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AssetRowDto,
  BucketDto,
  PortfolioDto,
  TargetsResponseDto,
} from "@/lib/api/types";
import { formatUsd } from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";

/**
 * Экран «Цели» (S1.6), две части:
 * 1) редактор целевых процентов по корзинам — живой индикатор суммы,
 *    сумма != 100% — предупреждение, НЕ блокировка;
 * 2) управление корзинами — создание/удаление своих (встроенные защищены)
 *    и перенос активов между корзинами (override поверх дефолтного маппинга).
 */

// ---------------------------------------------------------------------------
// Редактор целей
// ---------------------------------------------------------------------------

function formatSum(sum: number): string {
  const s = sum.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function TargetsEditor({
  buckets,
  targetsData,
  onSaved,
}: {
  buckets: BucketDto[];
  targetsData: TargetsResponseDto;
  onSaved: () => void;
}) {
  // bucketId -> строка инпута; пустая строка = цель не задана
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<
    { kind: "ok" | "warn" | "error"; text: string } | null
  >(null);

  // Инициализация из загруженных целей (и при их обновлении с сервера)
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const t of targetsData.targets) next[t.bucketId] = String(t.targetPct);
    setValues(next);
  }, [targetsData]);

  const sum = useMemo(() => {
    let s = 0;
    for (const v of Object.values(values)) {
      const n = Number.parseFloat(v);
      if (Number.isFinite(n)) s += n;
    }
    return Math.round(s * 100) / 100;
  }, [values]);

  const sumIs100 = Math.abs(sum - 100) < 0.001;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const targets = Object.entries(values)
        .filter(([, v]) => v.trim() !== "")
        .map(([bucketId, v]) => ({
          bucketId,
          targetPct: Number.parseFloat(v),
        }))
        .filter((t) => Number.isFinite(t.targetPct));
      const res = await apiFetch<TargetsResponseDto>("/api/targets", {
        method: "PUT",
        body: JSON.stringify({ targets }),
      });
      setNotice(
        res.warning
          ? { kind: "warn", text: `Сохранено. ${res.warning}` }
          : { kind: "ok", text: "Цели сохранены" },
      );
      onSaved();
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
    <form
      onSubmit={handleSave}
      className="rounded-lg border border-gray-200 bg-white p-4"
    >
      <h2 className="text-sm font-medium text-gray-700">Целевые проценты</h2>
      <p className="mt-1 text-xs text-gray-500">
        Проценты задаются на корзины (классы активов), не на отдельные токены.
        Пустое поле — без цели.
      </p>

      <ul className="mt-3 divide-y divide-gray-100">
        {buckets.map((b) => (
          <li key={b.id} className="flex items-center gap-3 py-2">
            <label
              htmlFor={`target-${b.id}`}
              className="min-w-0 flex-1 truncate text-sm text-gray-900"
            >
              {b.name}
              {b.builtin && (
                <span className="ml-2 text-xs text-gray-400">встроенная</span>
              )}
            </label>
            <div className="flex items-center gap-1">
              <input
                id={`target-${b.id}`}
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.5}
                placeholder="—"
                value={values[b.id] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [b.id]: e.target.value }))
                }
                className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </li>
        ))}
      </ul>

      {/* Живой индикатор суммы (S1.6: предупреждение, не блокировка) */}
      <p
        role="status"
        className={`mt-2 rounded-md px-3 py-2 text-sm ${
          sumIs100
            ? "bg-emerald-50 text-emerald-800"
            : "bg-amber-50 text-amber-800"
        }`}
      >
        {sumIs100
          ? "Сумма: 100%"
          : `Сумма: ${formatSum(sum)}% — отклонения будут считаться от заданных целей`}
      </p>

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mt-2 rounded-md px-3 py-2 text-sm ${
            notice.kind === "ok"
              ? "bg-emerald-50 text-emerald-800"
              : notice.kind === "warn"
                ? "bg-amber-50 text-amber-800"
                : "bg-red-50 text-red-700"
          }`}
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
    </form>
  );
}

// ---------------------------------------------------------------------------
// Управление корзинами: создание / удаление своих
// ---------------------------------------------------------------------------

function BucketsEditor({
  buckets,
  onChanged,
}: {
  buckets: BucketDto[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await apiFetch("/api/buckets", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      setName("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await apiFetch(`/api/buckets/${id}`, { method: "DELETE" });
      setConfirmingId(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-medium text-gray-700">Корзины</h2>
      <p className="mt-1 text-xs text-gray-500">
        Встроенные корзины удалить нельзя. При удалении своей корзины ее активы
        возвращаются в корзину по умолчанию, цель по ней снимается.
      </p>

      <ul className="mt-3 divide-y divide-gray-100">
        {buckets.map((b) => (
          <li key={b.id} className="py-2">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                {b.name}
                {b.builtin && (
                  <span className="ml-2 text-xs text-gray-400">встроенная</span>
                )}
              </span>
              {!b.builtin && confirmingId !== b.id && (
                <button
                  type="button"
                  onClick={() => setConfirmingId(b.id)}
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                >
                  Удалить
                </button>
              )}
            </div>
            {confirmingId === b.id && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                <span className="text-sm text-red-800">
                  Удалить корзину «{b.name}»?
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(b.id)}
                  disabled={deletingId === b.id}
                  className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deletingId === b.id ? "Удаление…" : "Удалить"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingId(null)}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                >
                  Отмена
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="mt-3 flex gap-2">
        <label htmlFor="new-bucket-name" className="sr-only">
          Название новой корзины
        </label>
        <input
          id="new-bucket-name"
          type="text"
          maxLength={64}
          placeholder="Например, L2-альты"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {creating ? "Создание…" : "Создать"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Перенос активов между корзинами
// ---------------------------------------------------------------------------

const RESET_VALUE = "__reset";

function AssetAssignRow({
  asset,
  currentBucketId,
  buckets,
  onChanged,
}: {
  asset: AssetRowDto;
  /** null — эффективная корзина неизвестна (нераспознанные/скрытые). */
  currentBucketId: string | null;
  buckets: BucketDto[];
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleMove(value: string) {
    setPending(true);
    setError(null);
    try {
      // Строка активов может объединять несколько asset_id
      // (один токен на разных сетях) — override применяется ко всем.
      const bucketId = value === RESET_VALUE ? null : value;
      await Promise.all(
        asset.assetIds.map((assetId) =>
          apiFetch("/api/buckets/override", {
            method: "PUT",
            body: JSON.stringify({ assetId, bucketId }),
          }),
        ),
      );
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось перенести");
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="min-w-0 flex-1">
        <span className="text-sm font-medium text-gray-900">{asset.symbol}</span>
        {asset.valueUsd !== null && (
          <span className="ml-2 text-xs tabular-nums text-gray-500">
            {formatUsd(asset.valueUsd)}
          </span>
        )}
      </span>
      <select
        aria-label={`Корзина для ${asset.symbol}`}
        value={currentBucketId ?? ""}
        disabled={pending}
        onChange={(e) => handleMove(e.target.value)}
        className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 disabled:opacity-50"
      >
        {currentBucketId === null && (
          <option value="" disabled>
            Корзина…
          </option>
        )}
        {buckets.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
        <option value={RESET_VALUE}>Сбросить (по умолчанию)</option>
      </select>
      {error && (
        <p role="alert" className="w-full text-xs text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}

function AssetAssignment({
  portfolio,
  buckets,
  onChanged,
}: {
  portfolio: PortfolioDto;
  buckets: BucketDto[];
  onChanged: () => void;
}) {
  const groups: {
    key: string;
    title: string;
    bucketId: string | null;
    assets: AssetRowDto[];
  }[] = [
    ...portfolio.buckets
      .filter((b) => b.assets.length > 0)
      .map((b) => ({
        key: b.bucketId,
        title: b.name,
        bucketId: b.bucketId as string | null,
        assets: b.assets,
      })),
    ...(portfolio.hidden.length > 0
      ? [
          {
            key: "__hidden",
            title: "Скрытые < $1",
            bucketId: null,
            assets: portfolio.hidden,
          },
        ]
      : []),
    ...(portfolio.unrecognized.length > 0
      ? [
          {
            key: "__unrecognized",
            title: "Нераспознанные",
            bucketId: null,
            assets: portfolio.unrecognized,
          },
        ]
      : []),
  ];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-medium text-gray-700">Активы по корзинам</h2>
      <p className="mt-1 text-xs text-gray-500">
        Любой актив можно перенести в другую корзину. «Сбросить» возвращает
        встроенный маппинг (или «Прочее»).
      </p>

      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">
          Активов пока нет — добавьте кошелек и обновите портфель на дашборде.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="mt-3" aria-label={g.title}>
            <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
              {g.title}
            </h3>
            <ul className="divide-y divide-gray-100">
              {g.assets.map((a) => (
                <AssetAssignRow
                  key={a.key}
                  asset={a}
                  currentBucketId={g.bucketId}
                  buckets={buckets}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Экран целиком
// ---------------------------------------------------------------------------

export function TargetsManager() {
  const bucketsApi = useApi<{ buckets: BucketDto[] }>("/api/buckets");
  const targetsApi = useApi<TargetsResponseDto>("/api/targets");
  const portfolioApi = useApi<PortfolioDto>("/api/portfolio");

  const loading =
    (bucketsApi.loading && !bucketsApi.data) ||
    (targetsApi.loading && !targetsApi.data);
  const loadError = bucketsApi.error ?? targetsApi.error;

  if (loading) {
    return (
      <div aria-busy="true" className="space-y-4">
        <div className="h-56 animate-pulse rounded-lg bg-gray-100" />
        <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
        <p className="sr-only">Загрузка целей…</p>
      </div>
    );
  }

  if (!bucketsApi.data || !targetsApi.data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <p>Не удалось загрузить данные: {loadError ?? "неизвестная ошибка"}</p>
        <button
          type="button"
          onClick={() => {
            void bucketsApi.refetch();
            void targetsApi.refetch();
          }}
          className="mt-2 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium hover:bg-red-100"
        >
          Повторить
        </button>
      </div>
    );
  }

  const buckets = bucketsApi.data.buckets;

  const refetchAll = () => {
    void bucketsApi.refetch();
    void targetsApi.refetch();
    void portfolioApi.refetch();
  };

  return (
    <div className="space-y-4">
      <TargetsEditor
        buckets={buckets}
        targetsData={targetsApi.data}
        onSaved={() => void portfolioApi.refetch()}
      />
      <BucketsEditor buckets={buckets} onChanged={refetchAll} />
      {portfolioApi.data ? (
        <AssetAssignment
          portfolio={portfolioApi.data}
          buckets={buckets}
          onChanged={() => void portfolioApi.refetch()}
        />
      ) : portfolioApi.error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          Активы для переноса не загрузились: {portfolioApi.error}
        </p>
      ) : (
        <div aria-busy="true" className="h-32 animate-pulse rounded-lg bg-gray-100" />
      )}
    </div>
  );
}
