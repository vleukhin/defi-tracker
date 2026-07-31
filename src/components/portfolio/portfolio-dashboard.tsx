"use client";

import { CircleAlert, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatHf, formatHfThreshold } from "@/components/debt/hf";
import { LogoMark } from "@/components/logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  DebtResponseDto,
  PortfolioDto,
  RefreshResponseDto,
} from "@/lib/api/types";
import {
  DEVIATION_THRESHOLD_PP,
  NBSP,
  chainLabel,
  formatRelativeTime,
  tablePctSigned,
  tableUsd,
} from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { AllocationBar } from "./allocation-bar";
import { MetricCards } from "./metric-cards";
import { OverviewStrip } from "./overview-strip";
import { PortfolioTable } from "./portfolio-table";
import { ValueSparkline } from "./value-sparkline";

/**
 * Дашборд портфеля — «30-секундная проверка» (S1.7).
 * Заголовок экрана рисует PortfolioTabs: рядом живет вкладка «Зоны»
 * (Фаза 6) — тот же портфель в разрезе стратегии, а не другой набор данных.
 * Stale-while-revalidate: GET /api/portfolio (только кэш) рисуется сразу,
 * POST /api/refresh уходит фоном; экран «только спиннер» запрещен.
 * Автообновление раз в 15 минут; отказ сети — неблокирующий баннер.
 */

const AUTO_REFRESH_MS = 15 * 60_000;

export function PortfolioDashboard() {
  const { data, error, loading, refetch } =
    useApi<PortfolioDto>("/api/portfolio");
  // HF-бейдж (S4.3): /api/debt — только кэш, второй запрос дешев
  const { data: debt, refetch: refetchDebt } =
    useApi<DebtResponseDto>("/api/debt");
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
      if (!allDebounced) {
        refetch();
        void refetchDebt();
      }
    } catch (err) {
      setRefreshError(
        err instanceof ApiError ? err.message : "Не удалось обновить данные",
      );
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [refetch, refetchDebt]);

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

  // Скелетоны формой повторяют будущий контент (ТЗ §6.1)
  if (loading && !data) {
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Skeleton className="h-[92px] rounded-xl" />
          <Skeleton className="h-[92px] rounded-xl" />
          <Skeleton className="h-[92px] rounded-xl" />
        </div>
        <Skeleton className="h-3 rounded-full" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-5">
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>Не удалось загрузить портфель: {error}</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              size="sm"
              onClick={refetch}
              className="mt-2"
            >
              Повторить
            </Button>
          </AlertDescription>
        </Alert>
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
    <div className="space-y-5">
      {/* Шапка: итог — самый крупный элемент экрана, тезис страницы (§5.1.1) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Связка пяти чисел (S4.2) + постоянный HF-бейдж (S4.3) */}
          <div className="mt-2">
            <OverviewStrip
              overview={data.overview}
              debtSummary={debt?.summary ?? null}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            цены: {formatRelativeTime(data.freshness.oldestPriceAt) ?? "—"}
            {NBSP}·{NBSP}залог:{" "}
            {formatRelativeTime(data.freshness.oldestCollateralAt) ?? "нет данных"}
            {refreshing && (
              <span className="ml-2 inline-flex items-baseline gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-1.5 self-center rounded-full bg-primary animate-pulse"
                />
                обновляется…
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void doRefresh()}
          disabled={refreshing}
          aria-label="Обновить"
          className="max-sm:size-9 max-sm:p-0"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          <span className="hidden sm:inline">
            {refreshing ? "Обновление…" : "Обновить"}
          </span>
        </Button>
      </div>

      {/* HF ниже порога — заметное предупреждение (S4.3), первым из баннеров */}
      {debt?.summary.belowThreshold &&
        debt.summary.minHealthFactor !== null && (
          <Alert variant="destructive">
            <TriangleAlert className="size-4" />
            <AlertTitle>
              Health factor{" "}
              <span className="font-mono">
                {formatHf(debt.summary.minHealthFactor)}
              </span>{" "}
              ниже порога{" "}
              <span className="font-mono">
                {formatHfThreshold(debt.summary.hfWarningThreshold)}
              </span>{" "}
              — риск ликвидации
            </AlertTitle>
            <AlertDescription>
              <Link href="/debt" className="underline underline-offset-4">
                Открыть экран «Долг»
              </Link>
            </AlertDescription>
          </Alert>
        )}

      {/* Баннеры деградации — только при проблемах, неблокирующие (§5.1.2) */}
      {refreshError && (
        <Alert variant="warning">
          <TriangleAlert className="size-4" />
          <AlertTitle>{refreshError}</AlertTitle>
        </Alert>
      )}

      {chainIssues.size > 0 && (
        <Alert variant="warning">
          <TriangleAlert className="size-4" />
          <AlertTitle>Данные по сетям устарели</AlertTitle>
          <AlertDescription>
            <ul className="space-y-0.5">
              {[...chainIssues.entries()].map(([chain, message]) => (
                <li key={chain}>
                  {chainLabel(chain)}: данные устарели ({message})
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {data.targetSumPct !== 0 &&
        maxDev?.percentDiff != null &&
        Math.abs(maxDev.percentDiff) > DEVIATION_THRESHOLD_PP && (
          <Alert variant="warning">
            <TriangleAlert className="size-4" />
            <AlertTitle>
              Максимальное отклонение: {maxDev.label}{" "}
              <span className="font-mono">
                {tablePctSigned(maxDev.percentDiff)}
              </span>{" "}
              (
              <span className="font-mono">
                {tableUsd(
                  Math.abs(
                    maxDev.amountUsd -
                      (maxDev.targetPercent! / 100) * data.totalUsd,
                  ),
                )}
              </span>{" "}
              {maxDev.percentDiff > 0 ? "сверх цели" : "ниже цели"})
            </AlertTitle>
          </Alert>
        )}

      <MetricCards rows={data.rows} />

      {data.targetSumPct === 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Задайте целевые проценты, чтобы видеть отклонения и количество к
            ребалансировке.
          </p>
          <Button asChild size="sm">
            <Link href="/targets">Задать цели</Link>
          </Button>
        </Card>
      )}

      <AllocationBar rows={data.rows} totalUsd={data.totalUsd} />

      <ValueSparkline />

      <PortfolioTable rows={data.rows} totalUsd={data.totalUsd} />

      {data.targetSumPct !== 0 &&
        Math.abs(data.targetSumPct - 100) > 0.001 && (
          <p className="text-xs text-warning">
            Сумма целей {data.targetSumPct}% — отклонения считаются от заданных
            целей.
          </p>
        )}

      <p className="text-xs text-muted-foreground">
        Количество к ребалансировке — расчет, а не финансовый совет.
      </p>
    </div>
  );
}

/** Пустое состояние (§5.1.8): заменяет весь дашборд. */
function EmptyState() {
  return (
    <div className="space-y-5">
      <Card className="p-6 text-center">
        <div className="mb-3 flex justify-center">
          <LogoMark size="lg" className="opacity-60" />
        </div>
        <p className="text-base font-medium">Портфель пока пуст</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Количество BTC и ETH подтягивается из залога на лендинг-маркетах —
          добавьте адрес кошелька. Проинвестированные стейблкоины и монеты вне
          лендинга вносятся вручную.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/wallets">Добавить кошелек</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/targets">Внести вручную</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
