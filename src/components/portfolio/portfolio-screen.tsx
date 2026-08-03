"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DcCard } from "@/components/dc/card";
import { StatusChip } from "@/components/dc/chip";
import { FreshnessDot, MetaDot, PageHeader } from "@/components/dc/page-header";
import { formatHf, formatHfThreshold } from "@/components/debt/hf";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ZonesScreen, type ZonesData } from "@/components/zones/zones-screen";
import type {
  DebtResponseDto,
  PortfolioDto,
  RefreshResponseDto,
  SnapshotDto,
  SnapshotsResponseDto,
} from "@/lib/api/types";
import { chainLabel, formatRelativeTime } from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import type { AssetsDelta } from "./overview-strip";
import { PortfolioDashboard } from "./portfolio-dashboard";
import { PortfolioHero } from "./portfolio-hero";
import { PortfolioViewSwitch, usePortfolioView } from "./portfolio-tabs";

/**
 * Главный экран «Портфель»: один капитал в двух разрезах.
 *
 * Данные тянутся здесь, а не в каждом режиме: hero-карточка общая, и при
 * переключении разреза числа не должны загружаться заново — переключатель
 * меняет проекцию, а не набор данных.
 *
 * Stale-while-revalidate: GET рисуются из кэша сразу, POST /api/refresh
 * уходит фоном. Экран «только спиннер» запрещён — крупные числа держат
 * своё место скелетоном.
 */

const AUTO_REFRESH_MS = 15 * 60_000;

export function PortfolioScreen() {
  const { view, setView } = usePortfolioView();

  const portfolio = useApi<PortfolioDto>("/api/portfolio");
  const debt = useApi<DebtResponseDto>("/api/debt");
  const zones = useApi<ZonesData>("/api/zones");
  const snapshots = useApi<SnapshotsResponseDto>("/api/snapshots?period=30d");

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [chainIssues, setChainIssues] = useState<Map<string, string>>(new Map());
  const refreshingRef = useRef(false);
  // Тик раз в минуту — метки «N мин назад» не застывают
  const [, setTick] = useState(0);

  const refetchPortfolio = portfolio.refetch;
  const refetchDebt = debt.refetch;
  const refetchZones = zones.refetch;

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
        void refetchPortfolio();
        void refetchDebt();
        void refetchZones();
      }
    } catch (err) {
      setRefreshError(
        err instanceof ApiError ? err.message : "Не удалось обновить данные",
      );
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [refetchPortfolio, refetchDebt, refetchZones]);

  // Первое обновление — после того как кэш отрисован
  const hasWallets = (portfolio.data?.wallets.length ?? 0) > 0;
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

  const data = portfolio.data;
  const debtSummary = debt.data?.summary ?? null;

  const header = (
    <PageHeader
      title="Портфель"
      meta={
        data ? (
          <>
            <FreshnessDot stale={data.freshness.anyPriceStale} />
            <span>
              цены {formatRelativeTime(data.freshness.oldestPriceAt) ?? "—"}
            </span>
            <MetaDot />
            <span>
              залог{" "}
              {formatRelativeTime(data.freshness.oldestCollateralAt) ??
                "нет данных"}
            </span>
            {refreshing && (
              <>
                <MetaDot />
                <span>обновляется…</span>
              </>
            )}
          </>
        ) : undefined
      }
      action={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void doRefresh()}
            disabled={refreshing}
            aria-label="Обновить данные"
            title="Обновить данные"
            className="max-sm:size-11"
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          </Button>
          <PortfolioViewSwitch view={view} setView={setView} />
        </div>
      }
    />
  );

  return (
    <TooltipProvider delayDuration={120}>
      <div className="flex flex-col gap-4">
        {header}

        {portfolio.loading && !data && <ScreenSkeleton />}

        {portfolio.error && !data && (
          <DcCard className="flex flex-col items-start gap-3 px-card py-5">
            <p className="t-body">
              Не удалось загрузить портфель: {portfolio.error}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetchPortfolio()}
            >
              Повторить
            </Button>
          </DcCard>
        )}

        {data && data.wallets.length === 0 && data.totalUsd === 0 && (
          <EmptyPortfolio />
        )}

        {data && (data.wallets.length > 0 || data.totalUsd !== 0) && (
          <>
            {debtSummary?.belowThreshold &&
              debtSummary.minHealthFactor !== null && (
                <Banner
                  tone="loss"
                  chip={`HF ${formatHf(debtSummary.minHealthFactor)}`}
                  action={
                    <Link
                      href="/debt"
                      className="t-meta text-link underline-offset-4 hover:underline"
                    >
                      Открыть «Долг» →
                    </Link>
                  }
                >
                  Ниже порога{" "}
                  {formatHfThreshold(debtSummary.hfWarningThreshold)} — риск
                  ликвидации.
                </Banner>
              )}

            {refreshError && (
              <Banner tone="warn" chip="обновление не прошло">
                {refreshError} Показаны последние успешно прочитанные данные.
              </Banner>
            )}

            {chainIssues.size > 0 && (
              <Banner tone="warn" chip="данные устарели">
                {[...chainIssues.entries()]
                  .map(([chain, message]) => `${chainLabel(chain)}: ${message}`)
                  .join(" · ")}
              </Banner>
            )}

            <PortfolioHero
              view={view}
              portfolio={data}
              zones={zones.data?.zones ?? null}
              debtSummary={debtSummary}
              delta={assetsDelta(snapshots.data?.snapshots ?? [])}
            />

            {view === "zones" ? (
              zones.data ? (
                <ZonesScreen
                  data={zones.data}
                  debt={debt.data ?? null}
                  onRefetch={refetchZones}
                />
              ) : (
                <ZonesSkeleton error={zones.error} />
              )
            ) : (
              <PortfolioDashboard
                data={data}
                snapshots={snapshots.data}
                snapshotsLoading={snapshots.loading}
                snapshotsError={snapshots.error}
              />
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

/**
 * Дельта «Активов» за окно снепшотов. Активы точки — это портфель плюс
 * размещённые позиции; если позиции на одном из концов неизвестны, сравнение
 * идёт по портфелю, иначе дельта показала бы переезд капитала как доход.
 */
function assetsDelta(snapshots: SnapshotDto[]): AssetsDelta | null {
  if (snapshots.length < 2) return null;
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const withPositions =
    first.positionsUsd !== null && last.positionsUsd !== null;
  const from = first.totalUsd + (withPositions ? (first.positionsUsd ?? 0) : 0);
  const to = last.totalUsd + (withPositions ? (last.positionsUsd ?? 0) : 0);
  const absolute = to - from;
  return {
    absolute,
    percent: from === 0 ? null : (absolute / from) * 100,
    label: "за 30 дней",
  };
}

/**
 * Строка деградации: нейтральный блок плюс чип статуса. Семантический цвет
 * не растекается на фон и обводку (§2) — его несёт только чип.
 */
function Banner({
  tone,
  chip,
  children,
  action,
}: {
  tone: "warn" | "loss";
  chip: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-block border border-line bg-sunken px-card py-3">
      <StatusChip tone={tone}>{chip}</StatusChip>
      <p className="t-meta min-w-0 flex-1 text-text-2">{children}</p>
      {action}
    </div>
  );
}

/** Скелетон держит места конечных элементов, крупные числа не подменяются. */
function ScreenSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <DcCard>
        <div className="flex flex-wrap items-start gap-10 px-6 pt-[22px] pb-5">
          <div className="flex flex-col gap-2">
            <div className="h-3 w-16 rounded-pill bg-chip" />
            <div className="h-[44px] w-[230px] rounded-block bg-chip" />
            <div className="h-4 w-40 rounded-pill bg-chip" />
          </div>
          <div className="grid min-w-[240px] flex-1 grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="h-3 w-14 rounded-pill bg-chip" />
                <div className="h-[23px] w-24 rounded-pill bg-chip" />
              </div>
            ))}
          </div>
        </div>
        <div className="border-line border-t bg-sunken px-6 pt-[18px] pb-5">
          <div className="h-[34px] rounded-pill bg-chip" />
        </div>
      </DcCard>
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[132px] rounded-block bg-chip" />
        ))}
      </div>
    </div>
  );
}

function ZonesSkeleton({ error }: { error: string | null }) {
  if (error) {
    return (
      <DcCard className="px-card py-5">
        <p className="t-body text-text-2">Не удалось загрузить зоны: {error}</p>
      </DcCard>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[132px] rounded-block bg-chip" />
      ))}
    </div>
  );
}

/** Пустое состояние (§7): «Записей пока нет» плюс предложенное действие. */
function EmptyPortfolio() {
  return (
    <DcCard className="flex flex-col items-center gap-3 px-card py-10 text-center">
      <LogoMark size="lg" className="opacity-60" />
      <p className="t-h3">Портфель пока пуст</p>
      <p className="t-meta max-w-md text-text-3">
        Количество BTC и ETH подтягивается из залога на лендинг-маркетах —
        добавьте адрес кошелька. Стейблкоины и монеты вне лендинга вносятся
        вручную.
      </p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/wallets">Добавить кошелёк</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/targets">Внести вручную</Link>
        </Button>
      </div>
    </DcCard>
  );
}
