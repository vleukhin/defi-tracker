"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DcCard, EmptyState } from "@/components/dc/card";
import { HelpTip } from "@/components/dc/help-tip";
import { MetaDot, PageHeader } from "@/components/dc/page-header";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  DepositsResponseDto,
  SnapshotDto,
  SnapshotPeriod,
  SnapshotResponseDto,
  SnapshotsResponseDto,
} from "@/lib/api/types";
import { NBSP, tableDate, tableTimeUtc } from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { CompositionChart } from "./composition-chart";
import { PeriodSwitcher, periodFull } from "./period-switcher";
import { ProfitChart } from "./profit-chart";
import { QuantityCharts } from "./quantity-charts";
import { SnapshotsList } from "./snapshots-list";
import { ValueChart } from "./value-chart";

/**
 * Экран «История» (README, экран 5): динамика стоимости крупным числом,
 * три компактные карточки количеств (главная метрика стратегии — монеты,
 * а не доллары) и таблица снепшотов.
 *
 * Три сценария рисуются намеренно по-разному: истории нет вовсе, история
 * из одной точки (линия по одной точке — не график, а обман) и полная серия.
 */

/** Ежедневный серверный снепшот (S3.1) — та же формулировка на всех экранах. */
const CRON_NOTE = "Снепшот снимается автоматически раз в сутки, в 03:00 UTC.";

export function HistoryScreen() {
  const [period, setPeriod] = useState<SnapshotPeriod>("30d");
  const { data, error, loading, refetch } = useApi<SnapshotsResponseDto>(
    `/api/snapshots?period=${period}`,
  );
  // Журнал «Внесено» — второй источник графика Прибыли: в снепшот сумма
  // не пишется, она восстанавливается реплеем по happened_on. Период здесь
  // не нужен — на дату точки нужна сумма ВСЕГО журнала до неё
  const journal = useApi<DepositsResponseDto>("/api/deposits");
  const [taking, setTaking] = useState(false);

  async function takeSnapshot() {
    setTaking(true);
    try {
      const res = await apiFetch<SnapshotResponseDto>("/api/snapshots", {
        method: "POST",
      });
      // POST перезаписывает снепшот за сегодня — сообщение честно
      // различает первый съём за день и повторный
      const existed =
        data?.snapshots.some((s) => s.takenOn === res.snapshot.takenOn) ??
        false;
      const title = existed ? "Снепшот за сегодня обновлён" : "Снепшот создан";
      const reasons = res.partialReasons ?? [];
      if (reasons.length > 0) {
        toast.warning(`${title} — данные неполные`, {
          description: (
            <ul className="mt-1 space-y-0.5">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ),
        });
      } else {
        toast.success(title);
      }
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Не удалось снять снепшот",
      );
    } finally {
      setTaking(false);
    }
  }

  const snapshots = data?.snapshots ?? [];
  const periodLabel = periodFull(period);

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        <PageHeader
          title="История"
          meta={
            data === null ? (
              <span className="inline-block h-3.5 w-48 rounded-pill bg-chip" />
            ) : (
              <>
                <span>{snapshotCount(snapshots.length)}</span>
                <MetaDot />
                <span>{lastTaken(snapshots.at(-1) ?? null)}</span>
                <HelpTip>
                  {CRON_NOTE} Кнопка «Снепшот сейчас» снимает точку немедленно и
                  перезаписывает сегодняшнюю, если она уже есть.
                </HelpTip>
              </>
            )
          }
          action={
            <div className="flex flex-wrap items-center gap-2.5">
              <PeriodSwitcher period={period} onChange={setPeriod} />
              {/* Единственная primary-кнопка экрана — создающее действие */}
              <Button
                onClick={() => void takeSnapshot()}
                disabled={taking}
                title="Снять снепшот портфеля прямо сейчас"
              >
                {taking ? "Снимаем…" : "Снепшот сейчас"}
              </Button>
            </div>
          }
        />

        {loading && data === null && <HistorySkeleton />}

        {error !== null && data === null && (
          <DcCard as="section">
            <div className="flex flex-wrap items-center justify-between gap-3 px-card py-4">
              <p className="t-body text-text-2">
                Не удалось загрузить историю: {error}
              </p>
              <Button variant="outline" onClick={() => void refetch()}>
                Повторить
              </Button>
            </div>
          </DcCard>
        )}

        {data !== null && snapshots.length === 0 && (
          <DcCard as="section">
            <EmptyState
              title={
                period === "all"
                  ? "Истории пока нет"
                  : "За этот период снепшотов нет"
              }
              action={
                period === "all" ? (
                  <p className="t-meta max-w-md text-text-3">
                    {CRON_NOTE} Кнопка «Снепшот сейчас» снимает первую точку — с
                    неё и начнётся график.
                  </p>
                ) : (
                  <Button variant="outline" onClick={() => setPeriod("all")}>
                    Показать всё время
                  </Button>
                )
              }
            />
          </DcCard>
        )}

        {data !== null && snapshots.length >= 1 && (
          <>
            {/* Порядок: стоимость → количества → прибыль → пропорции → список.
                Доллары отвечают на вопрос «сколько», монеты — «чего именно
                стало больше», прибыль — «сколько из этого заработано»,
                пропорции остаются контекстом. Монеты выше прибыли намеренно:
                главная метрика стратегии — они (AGENTS.md), и долларовый
                график не должен спускать их под сгиб */}
            <ValueChart snapshots={snapshots} periodLabel={periodLabel} />
            <QuantityCharts snapshots={snapshots} periodLabel={periodLabel} />
            <ProfitChart
              snapshots={snapshots}
              deposits={journal.data?.deposits ?? null}
              // Ошибка журнала гасит только эту карточку: остальная история
              // от депозитов не зависит
              journalError={journal.error}
              periodLabel={periodLabel}
            />
            <CompositionChart snapshots={snapshots} periodLabel={periodLabel} />
            {/* key по периоду: смена периода возвращает список на первую страницу */}
            <SnapshotsList key={period} snapshots={snapshots} />
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

/** «31 снепшот» / «2 снепшота» / «5 снепшотов». */
function snapshotCount(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const word =
    mod100 >= 11 && mod100 <= 14
      ? "снепшотов"
      : mod10 === 1
        ? "снепшот"
        : mod10 >= 2 && mod10 <= 4
          ? "снепшота"
          : "снепшотов";
  return `${count}${NBSP}${word}`;
}

/** «последний сегодня в 09:14 UTC» — время съёма, а не время загрузки. */
function lastTaken(snapshot: SnapshotDto | null): string {
  if (snapshot === null) return "снепшотов нет";
  const time = tableTimeUtc(snapshot.takenAt);
  const today = new Date().toISOString().slice(0, 10);
  const when =
    snapshot.takenOn === today ? "сегодня" : tableDate(snapshot.takenOn);
  return `последний ${when} в ${time}${NBSP}UTC`;
}

/**
 * Скелетоны в цвете --bg-chip размерами конечных элементов: крупные числа
 * не заменяются спиннером, место под них держится (README, «Loading»).
 */
function HistorySkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <DcCard as="section">
        <div className="flex flex-wrap items-end justify-between gap-4 px-5 pt-[18px] pb-3.5">
          <div className="flex flex-col gap-2.5">
            <Bar className="h-2.5 w-36" />
            <Bar className="h-8 w-52" />
          </div>
          <div className="flex gap-7">
            <div className="flex flex-col items-end gap-2">
              <Bar className="h-2.5 w-20" />
              <Bar className="h-4 w-28" />
            </div>
            <div className="flex flex-col items-end gap-2">
              <Bar className="h-2.5 w-28" />
              <Bar className="h-4 w-36" />
            </div>
          </div>
        </div>
        <div className="border-line border-t bg-sunken px-4 py-4">
          <Bar className="h-[150px] w-full sm:h-[190px]" />
          <Bar className="mt-3 h-3 w-full" />
        </div>
      </DcCard>

      <div className="grid gap-3 sm:grid-cols-3">
        {["btc", "eth", "stable"].map((key) => (
          <DcCard key={key}>
            <div className="flex flex-col gap-2.5 px-card pt-4 pb-3">
              <Bar className="h-3 w-32" />
              <Bar className="h-5 w-24" />
            </div>
            <Bar className="h-[88px] w-full rounded-none" />
          </DcCard>
        ))}
      </div>

      <DcCard as="section">
        <div className="flex flex-col gap-2.5 px-5 pt-[18px] pb-3.5">
          <Bar className="h-2.5 w-24" />
          <Bar className="h-8 w-44" />
        </div>
        <div className="border-line border-t bg-sunken px-4 py-4">
          <Bar className="h-[150px] w-full sm:h-[190px]" />
        </div>
      </DcCard>
    </div>
  );
}

function Bar({ className }: { className?: string }) {
  return <span className={cn("block rounded-pill bg-chip", className)} />;
}
