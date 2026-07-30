"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PortfolioDto, RefreshResponseDto } from "@/lib/api/types";
import {
  DEVIATION_THRESHOLD_PP,
  NBSP,
  chainLabel,
  formatPp,
  formatRelativeTime,
  formatUsd,
} from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { PortfolioTable } from "./portfolio-table";

/**
 * Дашборд портфеля — «30-секундная проверка» (S1.7).
 * Stale-while-revalidate: GET /api/portfolio (только кэш) рисуется сразу,
 * POST /api/refresh уходит фоном; экран «только спиннер» запрещен.
 * Автообновление раз в 15 минут; отказ сети — неблокирующий баннер.
 */

const AUTO_REFRESH_MS = 15 * 60_000;

export function PortfolioDashboard() {
  const { data, error, loading, refetch } =
    useApi<PortfolioDto>("/api/portfolio");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [chainIssues, setChainIssues] = useState<Map<string, string>>(new Map());
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
      const issues = new Map<string, string>();
      for (const r of res.results) {
        for (const c of r.chains ?? []) {
          if (!c.ok) issues.set(c.chain, c.error ?? "ошибка чтения");
        }
      }
      setChainIssues(issues);
      // Все кошельки в окне дебаунса — данные те же, перезапрос не нужен
      const allDebounced =
        res.results.length > 0 && res.results.every((r) => r.debounced);
      if (!allDebounced) refetch();
    } catch (err) {
      setRefreshError(
        err instanceof ApiError ? err.message : "Не удалось обновить данные",
      );
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [refetch]);

  // Первое обновление — после того как кэш отрисован
  const hasWallets = (data?.wallets.length ?? 0) > 0;
  useEffect(() => {
    if (!hasWallets) return;
    const t = setTimeout(() => void doRefresh(), 0);
    return () => clearTimeout(t);
  }, [hasWallets, doRefresh]);

  useEffect(() => {
    if (!hasWallets) return;
    const id = setInterval(() => void doRefresh(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [hasWallets, doRefresh]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <div className="h-9 w-48 animate-pulse rounded bg-gray-200" />
        <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">
          Не удалось загрузить портфель: {error}
        </p>
        <button
          onClick={refetch}
          className="mt-2 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (!data) return null;

  if (data.wallets.length === 0 && data.totalUsd === 0) {
    return <EmptyState />;
  }

  const maxDev = data.rows.reduce<PortfolioDto["rows"][number] | null>(
    (worst, row) =>
      row.percentDiff !== null &&
      (worst === null ||
        Math.abs(row.percentDiff) > Math.abs(worst.percentDiff ?? 0))
        ? row
        : worst,
    null,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Портфель</h1>
          <p className="mt-1 text-3xl font-semibold tabular-nums sm:text-4xl">
            {formatUsd(data.totalUsd, 0)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            цены: {formatRelativeTime(data.freshness.oldestPriceAt) ?? "—"}
            {NBSP}·{NBSP}залог:{" "}
            {formatRelativeTime(data.freshness.oldestCollateralAt) ?? "нет данных"}
            {refreshing && (
              <span className="ml-2 text-gray-400">обновляется…</span>
            )}
          </p>
        </div>
        <button
          onClick={() => void doRefresh()}
          disabled={refreshing}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {refreshing ? "Обновление…" : "Обновить"}
        </button>
      </div>

      {refreshError && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {refreshError}
        </p>
      )}

      {[...chainIssues.entries()].map(([chain, message]) => (
        <p
          key={chain}
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {chainLabel(chain)}: данные устарели ({message})
        </p>
      ))}

      {data.targetSumPct === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-sm text-gray-600">
            Задайте целевые проценты, чтобы видеть отклонения и количество к
            ребалансировке.
          </p>
          <Link
            href="/targets"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            Задать цели
          </Link>
        </div>
      ) : (
        maxDev?.percentDiff != null &&
        Math.abs(maxDev.percentDiff) > DEVIATION_THRESHOLD_PP && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Максимальное отклонение: {maxDev.label}{" "}
            {formatPp(maxDev.percentDiff, 2)} (
            {formatUsd(
              Math.abs(
                maxDev.amountUsd - (maxDev.targetPercent! / 100) * data.totalUsd,
              ),
              0,
            )}{" "}
            {maxDev.percentDiff > 0 ? "сверх цели" : "ниже цели"})
          </p>
        )
      )}

      <PortfolioTable rows={data.rows} totalUsd={data.totalUsd} />

      {data.targetSumPct !== 0 &&
        Math.abs(data.targetSumPct - 100) > 0.001 && (
          <p className="text-xs text-amber-700">
            Сумма целей {data.targetSumPct}% — отклонения считаются от заданных
            целей.
          </p>
        )}

      <p className="text-xs text-gray-400">
        Количество к ребалансировке — расчет, а не финансовый совет.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Портфель</h1>
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-base font-medium text-gray-900">
          Портфель пока пуст
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
          Количество BTC и ETH подтягивается из залога на лендинг-маркетах —
          добавьте адрес кошелька. Проинвестированные стейблкоины и монеты вне
          лендинга вносятся вручную.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link
            href="/wallets"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Добавить кошелек
          </Link>
          <Link
            href="/targets"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Внести вручную
          </Link>
        </div>
      </div>
    </div>
  );
}
