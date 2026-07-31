"use client";

import {
  ChevronRight,
  CircleAlert,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  DebtChainDto,
  DebtResponseDto,
  RefreshResponseDto,
} from "@/lib/api/types";
import {
  NBSP,
  chainLabel,
  formatRelativeTime,
  tablePct,
  tableQuantity,
  tableUsd,
  usdDecimals,
} from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import {
  DEBT_UNREAD_HINT,
  HF_TEXT_CLASS,
  formatHf,
  formatHfThreshold,
  hfStatus,
  hfTitle,
} from "./hf";

/**
 * Вкладка «Долг» (Фаза 4, S4.1/S4.3), заголовок экрана рисует DebtTabs: сводка (общий долг, минимальный HF,
 * порог), по каждой сети — залог, занято, HF, утилизация и раскрываемая
 * разбивка долга по токенам. Данные — только кэш /api/debt; «Обновить»
 * гонит POST /api/refresh (тот же пайплайн, что на дашборде).
 *
 * Null-семантика честная: «долг не читался» — «—» с подсказкой, не ноль;
 * HF без долга — «∞», не переполненное число.
 */

export function DebtScreen() {
  const { data, error, loading, refetch } = useApi<DebtResponseDto>("/api/debt");
  const [refreshing, setRefreshing] = useState(false);
  // Тик раз в минуту — метка «данные: N мин назад» не застывает
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  async function doRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await apiFetch<RefreshResponseDto>("/api/refresh", { method: "POST" });
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Не удалось обновить данные",
      );
    } finally {
      setRefreshing(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>Не удалось загрузить данные о долге: {error}</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
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

  const { summary, chains } = data;
  // На экране про долг сети без долга — шум: залог по ним виден на дашборде,
  // а строка «занято $0 · HF ∞» ничего не сообщает. Показываем только те,
  // где действительно есть заем.
  const chainsWithDebt = chains.filter((c) => (c.totalDebtUsd ?? 0) > 0);
  const status = summary.totalDebtUsd === null
    ? null
    : hfStatus(summary.minHealthFactor, summary.hfWarningThreshold);
  // Свежесть — по самой старой проверке: свежая сеть не молодит остальные
  const oldestCheckedAt =
    chains
      .map((c) => c.checkedAt)
      .filter(Boolean)
      .sort()[0] ?? null;

  return (
    <div className="space-y-4">
      {/* Шапка: заголовок + свежесть + «Обновить», как на дашборде */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            данные: {formatRelativeTime(oldestCheckedAt) ?? "нет данных"}
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

      {/* HF ниже порога — заметное предупреждение (S4.3) */}
      {summary.belowThreshold && summary.minHealthFactor !== null && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>
            Health factor{" "}
            <span className="font-mono">
              {formatHf(summary.minHealthFactor)}
            </span>{" "}
            ниже порога{" "}
            <span className="font-mono">
              {formatHfThreshold(summary.hfWarningThreshold)}
            </span>{" "}
            — риск ликвидации
          </AlertTitle>
        </Alert>
      )}

      {/* Сводка: общий долг · минимальный HF (крупно) · порог */}
      <Card className="p-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
              Общий долг
            </dt>
            <dd
              className={cn(
                "mt-1 font-mono text-lg font-semibold",
                summary.totalDebtUsd === null && "text-muted-foreground",
              )}
              title={summary.totalDebtUsd === null ? DEBT_UNREAD_HINT : undefined}
            >
              {summary.totalDebtUsd === null
                ? "—"
                : tableUsd(summary.totalDebtUsd)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
              Мин. health factor
            </dt>
            <dd
              className={cn(
                "mt-1 font-mono text-3xl leading-none font-semibold tracking-tight",
                status !== null && HF_TEXT_CLASS[status],
              )}
              title={
                summary.totalDebtUsd === null
                  ? DEBT_UNREAD_HINT
                  : hfTitle(status ?? "none", summary.hfWarningThreshold)
              }
            >
              {summary.totalDebtUsd === null
                ? "—"
                : formatHf(summary.minHealthFactor)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
              Порог предупреждения
            </dt>
            <dd className="mt-1 font-mono text-lg font-semibold">
              {formatHfThreshold(summary.hfWarningThreshold)}
            </dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">
              настраивается в «Настройках»
            </dd>
          </div>
        </dl>
      </Card>

      {/* Пустые состояния: «не читался» ≠ «долга нет» */}
      {summary.totalDebtUsd === null && (
        <Card className="p-6 text-center">
          <p className="text-base font-medium">Данных о долге пока нет</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Долг читается вместе с залогом — нажмите «Обновить». Если
            кошельки не добавлены, начните с экрана «Кошельки».
          </p>
        </Card>
      )}

      {summary.totalDebtUsd === 0 && (
        <Card className="p-6 text-center">
          <p className="text-base font-medium">Долгов нет</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Когда вы займете средства на Aave, здесь появятся занятые активы,
            health factor и утилизация по каждой сети.
          </p>
        </Card>
      )}

      {chainsWithDebt.map((chain) => (
        <ChainCard
          key={chain.chain}
          chain={chain}
          threshold={summary.hfWarningThreshold}
        />
      ))}
    </div>
  );
}

/** Долг по одной сети: метрики + раскрываемая разбивка по токенам. */
function ChainCard({
  chain,
  threshold,
}: {
  chain: DebtChainDto;
  threshold: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = hfStatus(chain.healthFactor, threshold);
  const hasDebt = chain.totalDebtUsd !== null && chain.totalDebtUsd > 0;

  return (
    <Card className="p-0">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{chainLabel(chain.chain)}</h2>
        <span className="text-xs text-muted-foreground">
          проверено: {formatRelativeTime(chain.checkedAt) ?? "—"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-4">
        <ChainMetric
          label="Залог"
          value={
            chain.totalCollateralUsd === null
              ? "—"
              : tableUsd(chain.totalCollateralUsd)
          }
        />
        <ChainMetric
          label="Занято"
          value={
            chain.totalDebtUsd === null ? "—" : tableUsd(chain.totalDebtUsd)
          }
        />
        <ChainMetric
          label="Health factor"
          value={formatHf(chain.healthFactor)}
          className={HF_TEXT_CLASS[status]}
          title={hfTitle(status, threshold)}
        />
        <ChainMetric
          label="Утилизация"
          value={
            chain.utilization === null
              ? "—"
              : tablePct(chain.utilization * 100, 1)
          }
          title="занято / залог"
        />
      </dl>

      {chain.items.length > 0 && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-sm text-muted-foreground outline-none transition-colors duration-120 ease-out hover:bg-accent/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-3.5 transition-transform duration-150",
                expanded && "rotate-90",
              )}
            />
            Разбивка долга ({chain.items.length})
          </button>
          {expanded && (
            <ul className="divide-y divide-border border-t border-border">
              {chain.items.map((item) => (
                <li
                  key={`${item.symbol}-${item.quantity}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="text-sm font-medium">{item.symbol}</span>
                  <span className="flex items-baseline gap-3">
                    <span
                      className="font-mono text-sm"
                      title={tableQuantity(item.quantity, true)}
                    >
                      {tableQuantity(item.quantity)}
                    </span>
                    {item.valueUsd === null ? (
                      <span
                        className="font-mono text-sm text-muted-foreground"
                        title="нет цены"
                      >
                        ≈{NBSP}—
                      </span>
                    ) : (
                      <span className="font-mono text-sm text-muted-foreground">
                        {tableUsd(item.valueUsd, usdDecimals(item.valueUsd))}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {hasDebt && chain.items.length === 0 && (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          Разбивка долга по токенам недоступна.
        </p>
      )}
    </Card>
  );
}

function ChainMetric({
  label,
  value,
  className,
  title,
}: {
  label: string;
  value: string;
  className?: string;
  title?: string;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn("mt-1 font-mono text-sm font-semibold", className)}
        title={title}
      >
        {value}
      </dd>
    </div>
  );
}
