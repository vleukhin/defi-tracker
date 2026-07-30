"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PortfolioDto,
  RefreshResponseDto,
} from "@/lib/api/types";
import {
  DEVIATION_THRESHOLD_PP,
  chainLabel,
  formatPp,
  formatRelativeTime,
  formatUsd,
} from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { AssetList } from "./asset-list";
import { BucketTable } from "./bucket-table";
import { DonutChart } from "./donut-chart";

/**
 * Дашборд (S1.7) — «30-секундная проверка».
 * Stale-while-revalidate: GET /api/portfolio (только кэш) рендерится сразу,
 * POST /api/refresh уходит фоном; экран «только спиннер» запрещен (ТЗ §6.1).
 * Автообновление раз в 15 минут при открытой вкладке (S1.3);
 * отказ RPC одной сети — неблокирующий баннер, дашборд не пустеет.
 */

const AUTO_REFRESH_MS = 15 * 60_000;

interface ChainIssue {
  chain: string;
  error: string;
}

export function Dashboard() {
  const { data, error, loading, refetch } = useApi<PortfolioDto>("/api/portfolio");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [chainIssues, setChainIssues] = useState<ChainIssue[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const refreshingRef = useRef(false);
  // Тик раз в минуту — метки «N мин назад» не застывают
  const [, setTick] = useState(0);

  const doRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await apiFetch<RefreshResponseDto>("/api/refresh", {
        method: "POST",
      });
      // Деградация по сетям: один баннер на сеть (S1.3)
      const issues = new Map<string, string>();
      for (const r of res.results) {
        for (const c of r.chains ?? []) {
          if (!c.ok) issues.set(c.chain, c.error ?? "ошибка чтения");
        }
      }
      setChainIssues([...issues].map(([chain, err]) => ({ chain, error: err })));
      // Все кошельки в окне дебаунса -> кэш актуален, перезапрос не нужен
      const allDebounced =
        res.results.length > 0 && res.results.every((r) => r.debounced);
      if (!allDebounced) await refetch();
    } catch (e) {
      setRefreshError(
        e instanceof ApiError ? e.message : "Не удалось обновить данные",
      );
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [refetch]);

  useEffect(() => {
    void doRefresh();
    const refreshTimer = setInterval(() => void doRefresh(), AUTO_REFRESH_MS);
    const tickTimer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => {
      clearInterval(refreshTimer);
      clearInterval(tickTimer);
    };
  }, [doRefresh]);

  // --- Первичная загрузка: скелет, не спиннер ---
  if (loading && !data) {
    return (
      <div aria-busy="true" className="space-y-4">
        <PageHeading refreshing={false} onRefresh={doRefresh} disabled />
        <div className="h-24 animate-pulse rounded-lg bg-gray-100" />
        <div className="h-56 animate-pulse rounded-lg bg-gray-100" />
        <p className="sr-only">Загрузка портфеля…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4">
        <PageHeading refreshing={false} onRefresh={doRefresh} disabled />
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>Не удалось загрузить портфель: {error}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium hover:bg-red-100"
          >
            Повторить
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // --- Пустое состояние: нет кошельков ---
  if (data.wallets.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeading refreshing={false} onRefresh={doRefresh} disabled />
        <div className="rounded-lg border border-gray-200 bg-white px-6 py-10 text-center">
          <p className="text-lg font-medium text-gray-900">
            Добавьте первый кошелек
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
            Приложение читает балансы по публичному EVM-адресу на Ethereum,
            Arbitrum, Base и Optimism. Только просмотр — никаких приватных
            ключей.
          </p>
          <Link
            href="/wallets"
            className="mt-4 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Добавить кошелек
          </Link>
        </div>
      </div>
    );
  }

  const hasTargets = data.buckets.some((b) => b.targetPct !== null);
  const pricesAgo = formatRelativeTime(data.freshness.oldestPriceAt);
  const balancesAgo = formatRelativeTime(data.freshness.oldestBalanceAt);
  const maxDev = data.maxDeviation;

  return (
    <div className="space-y-4">
      <PageHeading
        refreshing={refreshing}
        onRefresh={doRefresh}
        disabled={refreshing}
      />

      {/* Шапка: итог + свежесть (S1.7) */}
      <div>
        <p className="text-4xl font-semibold tracking-tight tabular-nums text-gray-900">
          {formatUsd(data.totalUsd)}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          цены: {pricesAgo ?? "—"} · балансы: {balancesAgo ?? "—"}
          {refreshing && (
            <span className="ml-2 text-gray-400" role="status">
              обновляется…
            </span>
          )}
        </p>
      </div>

      {/* Неблокирующие баннеры деградации */}
      {refreshError && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          Обновление не удалось: {refreshError}. Показаны последние известные
          данные.
        </p>
      )}
      {chainIssues.map((issue) => (
        <p
          key={issue.chain}
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800"
        >
          {chainLabel(issue.chain)}: данные устарели ({issue.error})
        </p>
      ))}

      {/* Сводка одной строкой (S1.7) */}
      {maxDev && (
        <p
          className={`rounded-lg border px-4 py-2.5 text-sm ${
            Math.abs(maxDev.deviationPp) > DEVIATION_THRESHOLD_PP
              ? "border-orange-200 bg-orange-50 text-orange-900"
              : "border-gray-200 bg-white text-gray-700"
          }`}
        >
          Максимальное отклонение: {maxDev.name} {formatPp(maxDev.deviationPp)}{" "}
          ({formatUsd(Math.abs(maxDev.amountUsd), 0)}{" "}
          {maxDev.amountUsd >= 0 ? "сверх цели" : "ниже цели"})
        </p>
      )}

      {/* CTA: кошельки есть, целей нет */}
      {!hasTargets && data.totalUsd > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-sm text-gray-700">
            Задайте целевые проценты по корзинам, чтобы видеть отклонения и
            суммы ребалансировки.
          </p>
          <Link
            href="/targets"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            Задать цели
          </Link>
        </div>
      )}

      {/* Пустой портфель при добавленных кошельках */}
      {data.totalUsd === 0 && data.buckets.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-6 py-8 text-center">
          <p className="font-medium text-gray-900">Портфель пока пуст</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
            Балансы нулевые или еще не прочитаны. Нажмите «Обновить» — чтение
            четырех сетей занимает несколько секунд.
            {data.unrecognized.length > 0 &&
              " Найденные токены без цены — в секции «Нераспознанные» ниже."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <BucketTable buckets={data.buckets} />
          </div>
          <section
            aria-label="Донат-чарт аллокации"
            className="rounded-lg border border-gray-200 bg-white p-4 lg:col-span-1"
          >
            <h2 className="mb-3 text-sm font-medium text-gray-700">
              Текущая аллокация
            </h2>
            <DonutChart buckets={data.buckets} totalUsd={data.totalUsd} />
          </section>
        </div>
      )}

      {/* Нераспознанные (S1.4): без цены, вне итогов */}
      {data.unrecognized.length > 0 && (
        <details className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Нераспознанные ({data.unrecognized.length})
          </summary>
          <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
            Токены без цены CoinGecko — исключены из итогов и аллокации.
          </p>
          <AssetList assets={data.unrecognized} />
        </details>
      )}

      {/* Скрытые < $1 (S1.4): за переключателем */}
      {data.hidden.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            aria-expanded={showHidden}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <span>Скрытые &lt; $1 ({data.hidden.length})</span>
            <span className="text-xs text-gray-500">
              {showHidden ? "скрыть" : "показать скрытые"}
            </span>
          </button>
          {showHidden && (
            <div className="border-t border-gray-100">
              <AssetList assets={data.hidden} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PageHeading({
  refreshing,
  onRefresh,
  disabled,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold tracking-tight">Дашборд</h1>
      <button
        type="button"
        onClick={onRefresh}
        disabled={disabled}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {refreshing ? "Обновление…" : "Обновить"}
      </button>
    </div>
  );
}
