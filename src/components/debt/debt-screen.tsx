"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DcCard, Disclaimer, EmptyState } from "@/components/dc/card";
import { Chip } from "@/components/dc/chip";
import {
  FreshnessDot,
  MetaDot,
  PageHeader,
} from "@/components/dc/page-header";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  DebtResponseDto,
  LeverageResponseDto,
  PositionDto,
  RefreshResponseDto,
  SettingsDto,
  StableBorrowRateDto,
} from "@/lib/api/types";
import {
  chainLabel,
  formatRelativeTime,
  tableNumber,
} from "@/lib/format";
import { DEFAULT_TARGET_LTV_PCT } from "@/lib/settings-defaults";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { BorrowedWork, positionSpread } from "./borrowed-work";
import { DebtChains } from "./debt-chains";
import { DebtHero } from "./debt-hero";
import { DebtScenarios } from "./debt-scenarios";
import { liquidationLtvPercent } from "./risk";

/**
 * Экран «Долг» (README §6): насколько близка ликвидация, что будет с
 * запасом при падении залога и окупаются ли заёмные деньги.
 *
 * Вкладки «Долг / Левередж» убраны — в дизайне их нет, и по смыслу это
 * одна страница: заём и его размещение читают вместе. Позиции с той вкладки
 * переехали в «Где работают заёмные» рядом со сценариями.
 *
 * Привязки «займ → позиция» с экрана убраны намеренно: заём уходит в разные
 * позиции по частям, и связка «один заём — одна позиция» этого не выражает.
 * /api/leverage читается ради самих позиций, не ради связок.
 *
 * Данных трёх кэшей не хватает на один запрос: ставка займа и свободные
 * стейблы живут в /api/zones. Он читается отдельно и необязателен —
 * без него ставка и спред честно показываются как «—».
 */

/** Минимальный срез /api/zones: только то, чего нет в /api/debt и /api/leverage. */
interface ZonesSlice {
  stableBorrow: StableBorrowRateDto;
  stableCategoryUsd: number;
  zones: { ownInPositionsUsd: number };
}

export function DebtScreen() {
  const debt = useApi<DebtResponseDto>("/api/debt");
  const leverage = useApi<LeverageResponseDto>("/api/leverage");
  const zones = useApi<ZonesSlice>("/api/zones");
  // Цель LTV правится тут же, поэтому храним локально: перезапрашивать
  // настройки ради собственной правки — лишний круг
  const settings = useApi<SettingsDto>("/api/settings");
  const [targetLtvOverride, setTargetLtvOverride] = useState<number | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  // Тик раз в минуту — метка «залог N мин назад» не застывает
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
      await Promise.all([debt.refetch(), leverage.refetch(), zones.refetch()]);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Не удалось обновить данные",
      );
    } finally {
      setRefreshing(false);
    }
  }

  if (debt.loading && debt.data === null) return <DebtSkeleton />;

  if (debt.error !== null && debt.data === null) {
    return (
      <DcCard>
        <EmptyState
          title={`Не удалось загрузить данные о долге: ${debt.error}`}
          action={
            <Button variant="secondary" onClick={() => void debt.refetch()}>
              Повторить
            </Button>
          }
        />
      </DcCard>
    );
  }

  if (debt.data === null) return null;

  const { summary, chains } = debt.data;
  const threshold = summary.hfWarningThreshold;
  // Своя правка важнее ответа сервера: он мог быть прочитан до неё.
  // Пока настройки не пришли — дефолт стратегии, а не «—»: цель нужна
  // расчёту, и подставлять сюда пустоту значило бы гасить весь блок
  const targetLtvPct =
    targetLtvOverride ?? settings.data?.targetLtvPct ?? DEFAULT_TARGET_LTV_PCT;
  const positions: PositionDto[] = leverage.data?.positions ?? [];
  const borrowRatePercent = zones.data?.stableBorrow.ratePercent ?? null;

  // Свежесть — по самой старой проверке: свежая сеть не молодит остальные
  const oldestCheckedAt =
    chains
      .map((c) => c.checkedAt)
      .filter(Boolean)
      .sort()[0] ?? null;
  const freshness = formatRelativeTime(oldestCheckedAt);

  const header = (
    <PageHeader
      title="Долг"
      meta={
        <>
          <FreshnessDot stale={freshness === null} />
          <span>залог {freshness ?? "не читался"}</span>
          {refreshing && (
            <>
              <MetaDot />
              <span>обновляется…</span>
            </>
          )}
        </>
      }
      action={
        <div className="flex items-center gap-2">
          <Chip>порог предупреждения {tableNumber(threshold, 2)}</Chip>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void doRefresh()}
            disabled={refreshing}
            aria-label="Обновить"
            // Тач-ширины: hit-зона не меньше 44px (README, «Адаптив»)
            className="max-sm:h-11 max-sm:px-4"
          >
            <RefreshCw
              data-icon="inline-start"
              className={cn(refreshing && "animate-spin")}
            />
            <span className="max-sm:sr-only">
              {refreshing ? "Обновление…" : "Обновить"}
            </span>
          </Button>
        </div>
      }
    />
  );

  // Долг ни разу не читался и «долгов нет» — разные состояния, и выглядят
  // они по-разному: «—» это не ноль
  if (summary.totalDebtUsd === null || summary.totalDebtUsd === 0) {
    return (
      <TooltipProvider>
        <div className="flex flex-col gap-4">
          {header}
          <DcCard>
            <EmptyState
              title={
                summary.totalDebtUsd === null
                  ? "Данных о долге пока нет"
                  : "Долгов нет — ликвидация не грозит"
              }
              action={
                summary.totalDebtUsd === null ? (
                  <Button
                    variant="secondary"
                    onClick={() => void doRefresh()}
                    disabled={refreshing}
                  >
                    Обновить
                  </Button>
                ) : undefined
              }
            />
          </DcCard>
          <Disclaimer />
        </div>
      </TooltipProvider>
    );
  }

  const totalCollateralUsd = sumOrNull(
    chains.map((c) => c.totalCollateralUsd),
  );
  const ltvPercent =
    totalCollateralUsd !== null && totalCollateralUsd > 0
      ? (summary.totalDebtUsd / totalCollateralUsd) * 100
      : null;

  // Сценарии считаются по сети, задающей минимальный HF: ликвидация
  // приходит именно туда, и залог у неё свой
  const chainsWithDebt = chains.filter((c) => (c.totalDebtUsd ?? 0) > 0);
  const riskChain =
    chainsWithDebt
      .filter((c) => c.healthFactor !== null)
      .sort((a, b) => (a.healthFactor ?? 0) - (b.healthFactor ?? 0))[0] ?? null;

  const debtSymbols = [
    ...new Set(chains.flatMap((c) => c.items.map((i) => i.symbol))),
  ];

  // Спред портфеля к займу — средний по стоимости среди стейбл-размещений:
  // сравнивать ставку в ETH со стоимостью займа в стейблах нельзя
  const spreadPp = weightedSpread(positions, borrowRatePercent);

  const freeStablesUsd =
    zones.data === null
      ? null
      : Math.max(
          0,
          zones.data.stableCategoryUsd - zones.data.zones.ownInPositionsUsd,
        );

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        {header}

        <DebtHero
          healthFactor={summary.minHealthFactor}
          threshold={threshold}
          debtUsd={summary.totalDebtUsd}
          debtNote={
            debtSymbols.length > 0
              ? `${debtSymbols.join(" · ")} · Aave v3`
              : "Aave v3"
          }
          collateralUsd={totalCollateralUsd}
          collateralNote={
            chains.length > 0
              ? chains.map((c) => chainLabel(c.chain)).join(" · ")
              : null
          }
          ltvPercent={ltvPercent}
          liquidationLtvPercent={liquidationLtvPercent(chains)}
          borrowRatePercent={borrowRatePercent}
          spreadPp={spreadPp}
          targetLtvPct={targetLtvPct}
          onTargetLtvSaved={setTargetLtvOverride}
        />

        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <DebtScenarios
            healthFactor={riskChain?.healthFactor ?? summary.minHealthFactor}
            collateralUsd={riskChain?.totalCollateralUsd ?? totalCollateralUsd}
            threshold={threshold}
            multiChain={chainsWithDebt.length > 1}
          />
          <BorrowedWork
            positions={positions}
            borrowRatePercent={borrowRatePercent}
            freeStablesUsd={freeStablesUsd}
            loading={leverage.loading || zones.loading}
          />
        </div>

        {chains.length > 0 && (
          <DebtChains
            chains={chains}
            threshold={threshold}
            totalCollateralUsd={totalCollateralUsd}
            totalDebtUsd={summary.totalDebtUsd}
            minHealthFactor={summary.minHealthFactor}
          />
        )}

        <Disclaimer />
      </div>
    </TooltipProvider>
  );
}

/** Сумма с null-пропагацией: неизвестное слагаемое — неизвестная сумма. */
function sumOrNull(values: (number | null)[]): number | null {
  let sum = 0;
  for (const value of values) {
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

/** Средний по стоимости спред стейбл-размещений к ставке займа, п.п. */
function weightedSpread(
  positions: PositionDto[],
  borrowRatePercent: number | null,
): number | null {
  let weighted = 0;
  let total = 0;
  for (const position of positions) {
    const spread = positionSpread(position, borrowRatePercent);
    if (spread === null || position.valueUsd === null) continue;
    weighted += spread * position.valueUsd;
    total += position.valueUsd;
  }
  return total > 0 ? weighted / total : null;
}

/**
 * Скелетон в цвете --bg-chip размерами конечных элементов: крупное число
 * не подменяется спиннером, место под него держится (README, «Loading»).
 */
function DebtSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="h-[31px] w-[92px] rounded-control bg-chip" />
          <div className="mt-1.5 h-[14px] w-[160px] rounded-pill bg-chip" />
        </div>
        <div className="h-[21px] w-[190px] rounded-chip bg-chip" />
      </div>
      <div className="h-[268px] rounded-card bg-chip" />
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="h-[260px] rounded-card bg-chip" />
        <div className="h-[260px] rounded-card bg-chip" />
      </div>
    </div>
  );
}
