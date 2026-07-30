"use client";

import { Camera, ChartLine, CircleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  SnapshotDto,
  SnapshotPeriod,
  SnapshotResponseDto,
  SnapshotsResponseDto,
} from "@/lib/api/types";
import { tableDate, tableUsd } from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { CompositionChart } from "./composition-chart";
import { PeriodSwitcher, periodFull } from "./period-switcher";
import { SnapshotsList } from "./snapshots-list";
import { ValueChart } from "./value-chart";

/**
 * Экран «История» (Фаза 3, S3.1 + S3.2): динамика стоимости и пропорций
 * по снепшотам, список снепшотов с проваливанием в состав на дату
 * и ручной съем «Снепшот сейчас».
 *
 * Три сценария рисуются намеренно по-разному: истории нет вовсе,
 * история из одной точки (линия по одной точке — не график, а обман)
 * и полноценная серия.
 */

/** Ежедневный серверный снепшот (S3.1) — та же формулировка на всех экранах. */
const CRON_NOTE = "Снепшот снимается автоматически раз в сутки, в 03:00 UTC.";

export function HistoryScreen() {
  const [period, setPeriod] = useState<SnapshotPeriod>("30d");
  const { data, error, loading, refetch } = useApi<SnapshotsResponseDto>(
    `/api/snapshots?period=${period}`,
  );
  const [taking, setTaking] = useState(false);

  async function takeSnapshot() {
    setTaking(true);
    try {
      const res = await apiFetch<SnapshotResponseDto>("/api/snapshots", {
        method: "POST",
      });
      // POST перезаписывает снепшот за сегодня — сообщение честно
      // различает первый съем за день и повторный
      const existed =
        data?.snapshots.some((s) => s.takenOn === res.snapshot.takenOn) ?? false;
      const title = existed ? "Снепшот за сегодня обновлен" : "Снепшот создан";
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">История</h1>
        <Button
          size="sm"
          onClick={() => void takeSnapshot()}
          disabled={taking}
          title="Снять снепшот портфеля прямо сейчас"
        >
          <Camera className={cn("size-4", taking && "animate-pulse")} />
          {taking ? "Снимаем…" : "Снепшот сейчас"}
        </Button>
      </div>

      <PeriodSwitcher period={period} onChange={setPeriod} />

      {loading && !data && (
        <>
          <Skeleton className="h-64 rounded-xl" aria-hidden="true" />
          <Skeleton className="h-44 rounded-xl" aria-hidden="true" />
        </>
      )}

      {error && !data && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>Не удалось загрузить историю: {error}</AlertTitle>
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
      )}

      {data !== null && snapshots.length === 0 && (
        <EmptyState period={period} onAllTime={() => setPeriod("all")} />
      )}

      {data !== null && snapshots.length === 1 && (
        <SinglePointCard snapshot={snapshots[0]} />
      )}

      {data !== null && snapshots.length >= 2 && (
        <ValueChart snapshots={snapshots} periodLabel={periodFull(period)} />
      )}

      {data !== null && snapshots.length >= 1 && (
        <>
          <CompositionChart
            snapshots={snapshots}
            periodLabel={periodFull(period)}
          />
          <SnapshotsList snapshots={snapshots} />
        </>
      )}

      <p className="text-xs text-muted-foreground">
        {CRON_NOTE} Пропущенные дни на графиках остаются разрывами — история не
        достраивается расчетом.
      </p>
    </div>
  );
}

/** Истории нет: за выбранный период или вообще. */
function EmptyState({
  period,
  onAllTime,
}: {
  period: SnapshotPeriod;
  onAllTime: () => void;
}) {
  const narrowed = period !== "all";
  return (
    <Card className="p-6 text-center">
      <div className="mb-3 flex justify-center">
        <ChartLine
          aria-hidden="true"
          className="size-6 text-muted-foreground opacity-60"
        />
      </div>
      <p className="text-base font-medium">
        {narrowed ? "За этот период снепшотов нет" : "Истории пока нет"}
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {narrowed
          ? `${CRON_NOTE} Возможно, история началась раньше выбранного периода.`
          : `${CRON_NOTE} Кнопка «Снепшот сейчас» снимает точку немедленно — с нее и начнется график.`}
      </p>
      {narrowed && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onAllTime}>
          Показать все время
        </Button>
      )}
    </Card>
  );
}

/** Одна точка: линия по ней была бы вымыслом — показываем сам факт. */
function SinglePointCard({ snapshot }: { snapshot: SnapshotDto }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">Стоимость портфеля</h2>
        {snapshot.isPartial && <Badge variant="warning">частичный</Badge>}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 rounded-full",
            snapshot.isPartial
              ? "border-2 border-warning bg-background"
              : "bg-primary",
          )}
        />
        <div>
          <p className="font-mono text-2xl leading-none font-semibold tracking-tight">
            {tableUsd(snapshot.totalUsd)}
          </p>
          <p className="mt-1.5 font-mono text-xs text-muted-foreground">
            {tableDate(snapshot.takenOn)}
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Пока только одна точка — графику динамики нужна минимум вторая.{" "}
        {CRON_NOTE}
      </p>
    </Card>
  );
}
