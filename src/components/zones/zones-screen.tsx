"use client";

import { CircleAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  PositionDto,
  PositionsSummaryDto,
  StrategyZone,
  ZoneBreakdownDto,
  ZonesSummaryDto,
} from "@/lib/api/types";
import { pnlClass } from "@/components/pnl";
import {
  tablePct,
  tablePctSigned,
  tableUsd,
  tableUsdSigned,
  usdDecimals,
} from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

/**
 * Экран «Зоны» (Фаза 6) — разрез портфеля по стратегии Capital Growth
 * (docs/07-strategia-capital-growth.md).
 *
 * Зоны НЕ дублируют три категории: категория отвечает «в чем лежит»
 * (BTC / ETH / стейблы), зона — «какую задачу решает». Стейблкоины есть
 * и в Stability, и в Yield, поэтому один разрез через другой не выражается.
 *
 * Внизу — разметка позиций. По стратегии собственные стейблы всегда
 * распределены по позициям зон Yield и Stability, поэтому категория
 * «Стейблы» складывается именно из этих пометок, а не вводится одним числом.
 *
 * Вложенное задается ДВУМЯ числами — своим и заемным. Одной величиной
 * не обойтись: остаток «стоимость − свое» бывает и заемной частью, и
 * начисленным доходом. На депозите Fluid такой остаток был доходом,
 * а показывался как долг.
 */

const LABEL =
  "text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase";

/** Цвет зоны: тот же язык, что у категорий портфеля. */
const ZONE_ACCENT: Record<StrategyZone, string> = {
  growth: "var(--color-chart-1)",
  yield: "var(--color-chart-2)",
  stability: "var(--color-chart-3)",
};

const ZONE_OPTIONS: { value: StrategyZone; label: string }[] = [
  { value: "growth", label: "Growth" },
  { value: "yield", label: "Yield" },
  { value: "stability", label: "Stability" },
];

/** Что можно поправить у позиции за один запрос. */
interface MarkPatch {
  zone?: StrategyZone;
  ownPrincipalUsd?: number | null;
  borrowedPrincipalUsd?: number | null;
}

interface ZonesResponse {
  zones: ZonesSummaryDto;
  positions: PositionDto[];
  positionsSummary: PositionsSummaryDto;
  assetsUsd: number | null;
  stableCategoryUsd: number;
}

export function ZonesScreen() {
  const { data, error, loading, refetch } = useApi<ZonesResponse>("/api/zones");
  const [busy, setBusy] = useState(false);

  async function mark(position: PositionDto, patch: MarkPatch) {
    setBusy(true);
    try {
      const [protocol, chain, externalId] = splitKey(position.zoneKey);
      await apiFetch("/api/positions/mark", {
        method: "PUT",
        body: JSON.stringify({ protocol, chain, externalId, ...patch }),
      });
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Не удалось сохранить разметку",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <CircleAlert className="size-4" />
        <AlertTitle>Не удалось загрузить зоны: {error}</AlertTitle>
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
    );
  }

  if (!data) return null;

  const { zones, positions, positionsSummary, assetsUsd, stableCategoryUsd } =
    data;

  return (
    <div className="space-y-4">
      {zones.unmarkedPositions > 0 && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>
            Позиций без разметки: {zones.unmarkedPositions}
          </AlertTitle>
          <AlertDescription>
            Пока не указаны обе вложенные суммы, доход позиции не считается,
            а неразмеченная собственная часть занижает категорию «Стейблы».
            После перезаливки диапазона CLMM разметку нужно проставить заново.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {zones.zones.map((z) => (
          <ZoneCard key={z.zone} zone={z} />
        ))}
      </div>

      {/* Сверка. Сумма зон обязана совпасть с Активами; собственные доли
          позиций обязаны совпасть с категорией «Стейблы» */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold">Сверка</h2>
        <dl className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Metric
            label="Сумма зон"
            value={zones.totalUsd === null ? "—" : tableUsd(zones.totalUsd)}
          />
          <Metric
            label="Активы"
            value={assetsUsd === null ? "—" : tableUsd(assetsUsd)}
          />
          <Metric
            label="Своих в позициях"
            value={tableUsd(zones.ownInPositionsUsd)}
          />
          <Metric
            label="Категория «Стейблы»"
            value={tableUsd(stableCategoryUsd)}
          />
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          Собственные доли позиций и образуют категорию «Стейблы» — разница
          между ними это свободные стейблы, не вложенные никуда.
        </p>
        {positionsSummary.unpricedCount > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Позиций без оценки: {positionsSummary.unpricedCount} — суммы с ними
            не выводятся.
          </p>
        )}
      </Card>

      {positions.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-base font-medium">Позиций нет</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Здесь появятся депозиты Fluid, GM-пулы и LP-позиции, когда они
            будут прочитаны с кошельков.
          </p>
        </Card>
      ) : (
        <Card className="p-4">
          <h2 className="text-sm font-semibold">Разметка позиций</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Укажите, сколько в позицию вложено своих и сколько заемных.
            Доход считается как «стоимость − вложено» и делится между ними
            пропорционально. Из текущих собственных долей складывается
            категория «Стейблы» — вводить ее отдельно не нужно.
          </p>
          <ul className="mt-3 divide-y divide-border">
            {positions.map((p) => (
              <PositionRow
                key={p.id}
                position={p}
                busy={busy}
                onMark={mark}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function splitKey(key: string): [string, string, string] {
  const [protocol, chain, ...rest] = key.split(":");
  return [protocol, chain, rest.join(":")];
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className={LABEL}>{label}</dt>
      <dd className="font-mono text-sm font-semibold">{value}</dd>
    </div>
  );
}

function ZoneCard({ zone }: { zone: ZoneBreakdownDto }) {
  return (
    <Card
      className="p-4"
      style={{ boxShadow: `inset 3px 0 0 ${ZONE_ACCENT[zone.zone]}` }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{zone.label}</h2>
        <span className="font-mono text-xs text-muted-foreground">
          {zone.percent === null ? "—" : tablePct(zone.percent, 1)}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{zone.purpose}</p>

      <p
        className={cn(
          "mt-2 font-mono text-2xl leading-none font-semibold tracking-tight",
          zone.valueUsd === null && "text-muted-foreground",
        )}
      >
        {zone.valueUsd === null ? "—" : tableUsd(zone.valueUsd)}
      </p>

      <dl className="mt-3 space-y-1 text-xs">
        <Row label="Залог" value={zone.collateralUsd} hideZero />
        <Row label="Свободные стейблы" value={zone.manualUsd} hideZero />
        <Row
          label={`Позиции (${zone.positionCount})`}
          value={zone.positionsUsd}
          hideZero={zone.positionCount === 0}
        />
      </dl>
    </Card>
  );
}

function Row({
  label,
  value,
  hideZero,
}: {
  label: string;
  value: number | null;
  hideZero?: boolean;
}) {
  if (hideZero && value === 0) return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value === null ? "—" : tableUsd(value)}</dd>
    </div>
  );
}

/** Одна позиция: зона кнопками, два поля вложенного и доход. */
function PositionRow({
  position,
  busy,
  onMark,
}: {
  position: PositionDto;
  busy: boolean;
  onMark: (p: PositionDto, patch: MarkPatch) => void;
}) {
  const unmarked =
    position.ownPrincipalUsd === null || position.borrowedPrincipalUsd === null;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm">{position.title}</span>
            {unmarked && <Badge variant="warning">не размечено</Badge>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {position.protocolLabel}
            {" · стоит "}
            {position.valueUsd === null ? "—" : tableUsd(position.valueUsd)}
            {position.ownCurrentUsd !== null && !unmarked && (
              <>
                {" · своих сейчас "}
                {tableUsd(position.ownCurrentUsd)}
              </>
            )}
          </span>
        </span>

        <span className="flex gap-1">
          {ZONE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={busy}
              onClick={() => onMark(position, { zone: o.value })}
              aria-pressed={position.zone === o.value}
              className={cn(
                "rounded-md px-2 py-1 text-xs outline-none transition-colors duration-120 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                position.zone === o.value
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              {o.label}
            </button>
          ))}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <PrincipalInput
          id={`own-${position.id}`}
          label="Вложено своих, $"
          value={position.ownPrincipalUsd}
          busy={busy}
          onSave={(v) => onMark(position, { ownPrincipalUsd: v })}
        />
        <PrincipalInput
          id={`brw-${position.id}`}
          label="Вложено заемных, $"
          value={position.borrowedPrincipalUsd}
          busy={busy}
          onSave={(v) => onMark(position, { borrowedPrincipalUsd: v })}
        />

        {/* Доход = стоимость − вложено. Пока размечена лишь часть, показать
            его нельзя: остаток мог бы оказаться незаявленной заемной долей */}
        <div className="pb-1">
          <span className={LABEL}>Доход</span>
          <span
            className={cn(
              "ml-2 font-mono text-sm font-semibold",
              position.profitUsd === null
                ? "text-muted-foreground"
                : pnlClass(position.profitUsd),
            )}
            title={
              position.profitUsd === null
                ? "Размечены не обе вложенные суммы — доход не выводится"
                : undefined
            }
          >
            {position.profitUsd === null
              ? "—"
              : tableUsdSigned(
                  position.profitUsd,
                  usdDecimals(position.profitUsd),
                )}
            {position.profitPct !== null && (
              <span className="ml-1.5 text-xs font-normal">
                ({tablePctSigned(position.profitPct, 1)})
              </span>
            )}
          </span>
        </div>
      </div>
    </li>
  );
}

/**
 * Поле вложенной суммы. Пустое значение = «не размечено», и это не ноль:
 * ноль означал бы «вложено ничего» и объявил бы доходом всю стоимость.
 */
function PrincipalInput({
  id,
  label,
  value,
  busy,
  onSave,
}: {
  id: string;
  label: string;
  value: number | null;
  busy: boolean;
  onSave: (value: number | null) => void;
}) {
  const saved = value === null ? "" : String(value);
  const [draft, setDraft] = useState(saved);
  const dirty = draft.trim() !== saved;

  function save() {
    const raw = draft.trim().replace(",", ".");
    if (raw === "") {
      onSave(null);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Сумма должна быть неотрицательным числом");
      return;
    }
    onSave(parsed);
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          inputMode="decimal"
          placeholder="не указано"
          className="h-8 w-32 font-mono"
        />
        {dirty && (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={save}
            className="h-8"
          >
            OK
          </Button>
        )}
      </div>
    </div>
  );
}
