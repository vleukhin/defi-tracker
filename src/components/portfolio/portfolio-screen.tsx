"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DcCard } from "@/components/dc/card";
import { FreshnessDot, MetaDot, PageHeader } from "@/components/dc/page-header";
import { PullToRefresh } from "@/components/dc/pull-to-refresh";
import {
  periodChange,
  quantitySeries,
} from "@/components/history/quantity-series";
import { useNowMs } from "@/components/dc/use-now";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ZonesScreen, type ZonesData } from "@/components/zones/zones-screen";
import type {
  DebtResponseDto,
  GmJournalsResponseDto,
  PortfolioDto,
  PortfolioRowDto,
  RefreshResponseDto,
  SignalAcksResponseDto,
  SnapshotDto,
  DepositsResponseDto,
  SnapshotsResponseDto,
} from "@/lib/api/types";
import { formatRelativeTime } from "@/lib/format";
import {
  ASSETS_DELTA_LABEL,
  periodDelta,
} from "@/lib/portfolio/period-delta";
import { DEFAULT_TARGET_LTV_PCT } from "@/lib/settings-defaults";
import {
  ackedSignals,
  activeSignals,
  buildSignals,
  hasPendingSources,
  type SignalsInput,
} from "@/lib/signals/signals";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import type { AssetsDelta, CoinAmount } from "./overview-strip";
import { PortfolioDashboard } from "./portfolio-dashboard";
import { PortfolioHero } from "./portfolio-hero";
import { PortfolioViewSwitch, usePortfolioView } from "./portfolio-tabs";
import { needsRefreshOnEnter } from "./refresh-policy";
import { RiskStrip, SignalsCard } from "./signals-card";

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
  const snapshots = useApi<SnapshotsResponseDto>("/api/snapshots?period=30d");
  // «Внесено» живёт в журнале, а не в снепшоте: без него Прибыль по истории
  // равнялась бы Чистой — кривой, завышенной ровно на все взносы
  const journal = useApi<DepositsResponseDto>("/api/deposits");
  const acks = useApi<SignalAcksResponseDto>("/api/signals/ack");
  const journals = useApi<GmJournalsResponseDto>("/api/positions/gm-journal");

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [chainIssues, setChainIssues] = useState<Map<string, string>>(new Map());
  const refreshingRef = useRef(false);
  // Одно «сейчас» на весь экран, с тиком раз в минуту: метки «N мин назад»
  // не застывают, а таймер 48 часов в ленте идёт по тем же часам, что и
  // такой же таймер на карточке позиции в разрезе «Зоны»
  const nowMs = useNowMs();

  const refetchPortfolio = portfolio.refetch;
  const refetchDebt = debt.refetch;

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
        // Зоны приезжают в ответе портфеля — отдельного перезапроса нет
        void refetchPortfolio();
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
  }, [refetchPortfolio, refetchDebt]);

  const hasWallets = (portfolio.data?.wallets.length ?? 0) > 0;

  /**
   * Первое обновление — после того как кэш отрисован, и только если он
   * устарел (правило и его цена — в refresh-policy.ts).
   *
   * Порог свежести — тот же AUTO_REFRESH_MS, что и у интервала ниже: ровно
   * столько экран живёт на этих данных между тиками автообновления.
   *
   * Проверка внутри эффекта, а не в useMemo: Date.now() в рендере — вызов
   * нечистой функции (react-hooks/purity). Зависимость — сами кошельки:
   * эффект перезапускается на новых данных, а не на ежеминутном тике nowMs.
   * Цикла не образует: после обновления отметка становится свежей, а если
   * сервер ответил дебаунсом, экран не перезапрашивает данные и перезапуска
   * эффекта не происходит.
   */
  const wallets = portfolio.data?.wallets;
  useEffect(() => {
    if (!needsRefreshOnEnter(wallets, Date.now(), AUTO_REFRESH_MS)) return;
    const t = setTimeout(() => void doRefresh(), 0);
    return () => clearTimeout(t);
  }, [wallets, doRefresh]);

  useEffect(() => {
    if (!hasWallets) return;
    const id = setInterval(() => void doRefresh(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [hasWallets, doRefresh]);

  const data = portfolio.data;
  const debtSummary = debt.data?.summary ?? null;

  /**
   * Разрез «Зоны» — проекция того же ответа, а не отдельные данные.
   *
   * Плоский список свободных средств, доля категории «Стейблы» и Активы
   * выводятся из уже полученных строк: раньше их считал сервер в /api/zones,
   * ради чего собирал портфель второй раз целиком.
   */
  const zonesData = useMemo<ZonesData | null>(() => {
    if (!data) return null;
    return {
      zones: data.zones,
      positions: data.positions,
      positionsSummary: data.positionsSummary,
      stableBorrow: data.stableBorrow,
      assetsUsd: data.overview.assetsUsd,
      stableCategoryUsd:
        data.rows.find((r) => r.category === "stable")?.amountUsd ?? 0,
      free: data.rows.flatMap((r) => r.freeBalances),
      freeSummary: data.freeSummary,
      journals: journals.data?.journals ?? [],
    };
  }, [data, journals.data]);

  const actedGmLevels = useMemo(() => {
    const result = new Map<string, ReadonlySet<number>>();
    for (const journal of journals.data?.journals ?? []) {
      result.set(
        journal.zoneKey,
        new Set(journal.points[0]?.actions.map((action) => action.dropPercent) ?? []),
      );
    }
    return result;
  }, [journals.data]);

  // Лента считается из уже загруженных ответов — своих запросов у неё нет.
  // chainIssues и refreshError приходят из POST /api/refresh, а не из DTO,
  // поэтому в модуль они попадают отдельным полем runtime.
  const signalsInput = useMemo<SignalsInput>(
    () => ({
      portfolio: data,
      debt: debt.data,
      positions: zonesData?.positions ?? null,
      zones: zonesData?.zones ?? null,
      assetsUsd: zonesData?.assetsUsd ?? null,
      stableBorrowRatePercent: zonesData?.stableBorrow.ratePercent ?? null,
      targetLtvPct: debt.data?.summary.targetLtvPct ?? DEFAULT_TARGET_LTV_PCT,
      acks: acks.data?.acks ?? null,
      actedGmLevels,
      pending: {
        // Тот же довод, что у acks ниже: пока журнал едет, отработанность
        // уровня неизвестна. Здесь он весомее — сигнал уровня подавляется
        // именно журналом, и без него лента показала бы уже сделанное
        journals: journals.loading && journals.data === null,
        portfolio: portfolio.loading && data === null,
        debt: debt.loading && debt.data === null,
        // Зоны едут в том же ответе, что и портфель, — и ждут вместе с ним
        zones: portfolio.loading && zonesData === null,
        // Пока отметки едут, лента показала бы сигнал, на который владелец
        // уже ответил, и тут же его убрала. Если запрос не удался вовсе,
        // ждать нечего: сигналы покажутся неотмеченными — лишняя строка
        // безопаснее скрытой
        acks: acks.loading && acks.data === null,
      },
      runtime: {
        debtError: debt.error,
        // Отдельно от портфеля зоны больше не отказывают: источник один
        zonesError: portfolio.error,
        refreshError,
        chainIssues: [...chainIssues].map(([chain, message]) => ({
          chain,
          message,
        })),
      },
    }),
    [
      data,
      debt.data,
      debt.error,
      debt.loading,
      zonesData,
      portfolio.error,
      portfolio.loading,
      acks.data,
      acks.loading,
      actedGmLevels,
      journals.data,
      journals.loading,
      refreshError,
      chainIssues,
    ],
  );

  const signals = useMemo(
    () => buildSignals(signalsInput, nowMs),
    [signalsInput, nowMs],
  );
  const active = useMemo(() => activeSignals(signals), [signals]);
  const acked = useMemo(() => ackedSignals(signals), [signals]);
  const signalsPending = hasPendingSources(signalsInput);

  const refetchAcks = acks.refetch;
  const onAck = useCallback(
    async (signalKey: string, fingerprint: string | null) => {
      try {
        await apiFetch("/api/signals/ack", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signalKey, fingerprint }),
        });
        await refetchAcks();
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : "Не удалось сохранить отметку",
        );
      }
    },
    [refetchAcks],
  );

  const header = (
    <PageHeader
      title="Портфель"
      action={
        // flex-wrap: на 320px кнопка обновления и три сегмента вместе
        // перебирают ширину, и переключатель уходит на свою строку —
        // иначе PageHeader уносил весь блок целиком и всё равно не помогал
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          <PortfolioViewSwitch
            view={view}
            setView={setView}
            signalCount={active.length}
          />
        </div>
      }
    />
  );

  return (
    <TooltipProvider delayDuration={120}>
      <PullToRefresh onRefresh={() => void doRefresh()} refreshing={refreshing}>
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
            {/* Риск ликвидации виден из любого режима: единственный сценарий,
                способный принудительно прервать накопление, не может быть
                тем, за чем надо не забыть сходить на отдельную вкладку */}
            {view !== "signals" && (
              <RiskStrip
                signals={active}
                onOpenSignals={() => setView("signals")}
              />
            )}

            <PortfolioHero
              view={view}
              portfolio={data}
              zones={zonesData?.zones ?? null}
              debtSummary={debtSummary}
              delta={assetsDelta(snapshots.data?.snapshots ?? [])}
              coins={coinAmounts(data.rows, snapshots.data?.snapshots ?? [])}
              staleNote={
                data.freshness.anyPriceStale
                  ? `цены ${formatRelativeTime(data.freshness.oldestPriceAt) ?? "не читались"}`
                  : null
              }
            />

            {view === "signals" ? (
              <SignalsCard
                signals={active}
                acked={acked}
                pending={signalsPending}
                onOpenZones={() => setView("zones")}
                onAck={onAck}
              />
            ) : view === "zones" ? (
              zonesData ? (
                <ZonesScreen
                  data={zonesData}
                  debt={debt.data ?? null}
                  // Разметка позиции меняет и зоны, и категорию «Стейблы»
                  // (собственные доли позиций её и образуют), поэтому
                  // перечитывается портфель целиком, а не один разрез
                  onRefetch={refetchPortfolio}
                  onJournalRefetch={journals.refetch}
                />
              ) : (
                <ZonesSkeleton error={portfolio.error} />
              )
            ) : (
              <PortfolioDashboard
                data={data}
                snapshots={snapshots.data}
                snapshotsLoading={snapshots.loading}
                snapshotsError={snapshots.error}
                deposits={journal.data?.deposits ?? null}
                depositsError={journal.error}
              />
            )}
          </>
        )}
      </div>
      </PullToRefresh>
    </TooltipProvider>
  );
}

/**
 * Дельта «Активов» за окно снепшотов.
 *
 * Считает общая periodDelta (lib/portfolio/period-delta): та же величина
 * нужна карточке «Динамика стоимости» и графику «Истории», и пока каждый
 * считал сам, hero и карточка под ним показывали разные числа под одной
 * подписью. Подпись здесь тоже своя — «активы», а не просто «за 30 дней»:
 * это портфель ВМЕСТЕ с размещёнными позициями.
 */
function assetsDelta(snapshots: SnapshotDto[]): AssetsDelta | null {
  const delta = periodDelta(snapshots, "assets");
  if (delta === null) return null;
  return { ...delta, label: ASSETS_DELTA_LABEL };
}

/**
 * Количества BTC и ETH для hero — главная метрика стратегии (docs/07 §4).
 *
 * Стейблы отбрасываются по единице: их количество и есть доллары.
 * Изменение берётся из готовой periodChange по тому же окну снепшотов,
 * что и дельта активов, и остаётся null, пока истории меньше двух точек —
 * ноль вместо «неизвестно» здесь читался бы как «ничего не изменилось».
 */
function coinAmounts(
  rows: PortfolioRowDto[],
  snapshots: SnapshotDto[],
): CoinAmount[] {
  return rows
    .filter((row) => row.unit !== "USD" && row.amount !== null)
    .map((row) => ({
      key: row.category,
      unit: row.unit,
      amount: row.amount as number,
      change: periodChange(quantitySeries(snapshots, row.category))?.abs ?? null,
    }));
}

/** Скелетон держит места конечных элементов, крупные числа не подменяются. */
function ScreenSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {/* Место ленты сигналов: без него hero прыгает вверх на первом ответе */}
      <DcCard>
        <div className="flex flex-col gap-2.5 px-card py-4">
          <div className="h-3.5 w-40 rounded-pill bg-chip" />
          <div className="h-3 w-2/3 rounded-pill bg-chip" />
        </div>
      </DcCard>
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
