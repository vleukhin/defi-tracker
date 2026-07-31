"use client";

import { ChevronRight, CircleAlert, Link2Off, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { pnlClass } from "@/components/pnl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  LeverageBorrowDto,
  LeverageResponseDto,
  PositionDto,
  RefreshResponseDto,
} from "@/lib/api/types";
import {
  NBSP,
  chainLabel,
  formatRelativeTime,
  tableNumber,
  tablePctSigned,
  tableQuantity,
  tableUsd,
  tableUsdSigned,
  usdDecimals,
} from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

/**
 * Вкладка «Левередж» (Фаза 5, S5.3): куда размещены заемные средства и
 * оправдывает ли себя связка «занял и вложил».
 *
 * Три блока:
 *  1. Сводка — сколько размещено и как привязанные позиции соотносятся с долгом;
 *  2. Сверка Fluid — почему в Активы вошла не вся сумма депозита;
 *  3. Позиции и займы со связками.
 *
 * Привязка — бухгалтерская метка: ни на портфель, ни на пять чисел она
 * не влияет. Стоимость позиций в Активы входит независимо от того,
 * привязана позиция к займу или нет.
 */

const LABEL =
  "text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase";

const UNPRICED_HINT = "Стоимость этой позиции получить не удалось";

export function LeverageScreen() {
  const { data, error, loading, refetch } =
    useApi<LeverageResponseDto>("/api/leverage");
  const [refreshing, setRefreshing] = useState(false);
  const [busyLink, setBusyLink] = useState(false);

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

  async function link(borrowId: string, positionId: string) {
    if (busyLink) return;
    setBusyLink(true);
    try {
      await apiFetch("/api/borrow-links", {
        method: "POST",
        body: JSON.stringify({ borrowId, positionId }),
      });
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Не удалось привязать позицию",
      );
    } finally {
      setBusyLink(false);
    }
  }

  async function unlink(borrowId: string, positionId: string) {
    if (busyLink) return;
    setBusyLink(true);
    try {
      // Связка адресуется парой (она же уникальный ключ) — отдельный id
      // связки клиенту знать незачем
      await apiFetch(
        `/api/borrow-links?borrowId=${encodeURIComponent(borrowId)}&positionId=${encodeURIComponent(positionId)}`,
        { method: "DELETE" },
      );
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Не удалось снять привязку",
      );
    } finally {
      setBusyLink(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <CircleAlert className="size-4" />
        <AlertTitle>Не удалось загрузить размещение: {error}</AlertTitle>
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

  const { positions, borrows, summary, chains } = data;
  const failed = chains.filter((c) => !c.ok);
  const oldest =
    positions
      .map((p) => p.updatedAt)
      .filter(Boolean)
      .sort()[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          данные: {formatRelativeTime(oldest) ?? "нет данных"}
          {refreshing && (
            <span className="ml-2 inline-flex items-baseline gap-1.5">
              <span
                aria-hidden="true"
                className="size-1.5 animate-pulse self-center rounded-full bg-primary"
              />
              обновляется…
            </span>
          )}
        </p>
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

      {/* Отказ источника: «позиций нет» и «не смогли прочитать» — разные вещи */}
      {failed.length > 0 && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>
            Часть источников не прочитана — суммы могут быть неполными
          </AlertTitle>
          <AlertDescription>
            {failed
              .map((c) => `${c.source} · ${chainLabel(c.chain)}`)
              .join(", ")}
          </AlertDescription>
        </Alert>
      )}

      <SummaryCard summary={summary} />

      {summary.fluid.stableUsd !== null && summary.fluid.stableUsd > 0 && (
        <FluidCard fluid={summary.fluid} />
      )}

      {positions.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-base font-medium">Размещенных позиций нет</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Здесь появятся депозиты Fluid, GM-пулы GMX и LP-позиции Uniswap v3,
            когда они будут прочитаны с ваших кошельков.
          </p>
        </Card>
      ) : (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            Позиции ({positions.length})
          </h2>
          <div className="space-y-2">
            {positions.map((p) => (
              <PositionCard key={p.id} position={p} />
            ))}
          </div>
        </section>
      )}

      {borrows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Займы и их размещение</h2>
          <p className="text-xs text-muted-foreground">
            Привязка — только метка для этого экрана: на портфель и на связку
            пяти чисел она не влияет.
          </p>
          <div className="space-y-2">
            {borrows.map((b) => (
              <BorrowCard
                key={b.id}
                borrow={b}
                positions={positions}
                busy={busyLink}
                onLink={link}
                onUnlink={unlink}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SummaryCard({ summary }: { summary: LeverageResponseDto["summary"] }) {
  return (
    <Card className="p-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <div>
          <dt className={LABEL}>Размещено</dt>
          <dd
            className={cn(
              "mt-1 font-mono text-lg font-semibold",
              summary.positionsUsd === null && "text-muted-foreground",
            )}
            title="Вклад позиций в «Активы» — Fluid после вычета собственных стейблов"
          >
            {summary.positionsUsd === null
              ? "—"
              : tableUsd(summary.positionsUsd)}
          </dd>
        </div>
        <div>
          <dt className={LABEL}>Привязанный долг</dt>
          <dd className="mt-1 font-mono text-lg font-semibold">
            {summary.linkedDebtUsd === null
              ? "—"
              : tableUsd(summary.linkedDebtUsd)}
          </dd>
        </div>
        <div>
          <dt className={LABEL}>Привязанные позиции</dt>
          <dd className="mt-1 font-mono text-lg font-semibold">
            {summary.linkedPositionsUsd === null
              ? "—"
              : tableUsd(summary.linkedPositionsUsd)}
          </dd>
        </div>
        <div>
          <dt className={LABEL}>Дельта связки</dt>
          <dd
            className={cn(
              "mt-1 font-mono text-lg font-semibold",
              summary.linkedDeltaUsd === null
                ? "text-muted-foreground"
                : pnlClass(summary.linkedDeltaUsd),
            )}
            title="Стоимость привязанных позиций минус профинансировавший их долг"
          >
            {summary.linkedDeltaUsd === null
              ? "—"
              : tableUsdSigned(
                  summary.linkedDeltaUsd,
                  usdDecimals(summary.linkedDeltaUsd),
                )}
          </dd>
        </div>
      </dl>

      {summary.unpricedCount > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Без оценки: {summary.unpricedCount} — пока их стоимость неизвестна,
          «Активы» на дашборде не выводятся.
        </p>
      )}
    </Card>
  );
}

/**
 * Сверка Fluid: почему в Активы вошла не вся сумма депозита.
 * Без этого объяснения два числа выглядели бы ошибкой.
 */
function FluidCard({
  fluid,
}: {
  fluid: LeverageResponseDto["summary"]["fluid"];
}) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">Сверка Fluid</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Собственные и заемные стейблы на блокчейне неразличимы. Собственные уже
        учтены ручными записями категории «Стейблы», поэтому в «Активы»
        добавляется только разница.
      </p>
      <dl className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-sm">
        <dt className="sr-only">На Fluid</dt>
        <dd>{tableUsd(fluid.stableUsd ?? 0)}</dd>
        <span aria-hidden="true" className="text-muted-foreground">
          −
        </span>
        <dt className="sr-only">Ручные записи</dt>
        <dd>{tableUsd(fluid.manualStableUsd)}</dd>
        <span aria-hidden="true" className="text-muted-foreground">
          =
        </span>
        <dt className="sr-only">Заемная часть</dt>
        <dd className="font-semibold">
          {fluid.nettedUsd === null ? "—" : tableUsd(fluid.nettedUsd)}
        </dd>
        <span className="font-sans text-xs text-muted-foreground">
          на{NBSP}Fluid − вручную = заемная{NBSP}часть
        </span>
      </dl>

      {fluid.manualExceedsDeposit && (
        <p className="mt-2 text-xs text-warning">
          Ручных записей больше, чем лежит на Fluid. Это не ошибка, если часть
          стейблов хранится в другом месте, — иначе стоит поправить записи.
        </p>
      )}
    </Card>
  );
}

/** Одна позиция: стоимость, состав, комиссии; состав раскрывается. */
function PositionCard({ position }: { position: PositionDto }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left outline-none transition-colors duration-120 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {position.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {position.protocolLabel} · {chainLabel(position.chain)}
            {position.subtitle ? ` · ${position.subtitle}` : ""}
          </span>
        </span>
        {position.inRange === false && (
          <Badge variant="warning" className="shrink-0">
            вне диапазона
          </Badge>
        )}
        <span
          className={cn(
            "ml-auto shrink-0 font-mono text-sm font-semibold",
            position.valueUsd === null && "text-muted-foreground",
          )}
          title={position.valueUsd === null ? UNPRICED_HINT : undefined}
        >
          {position.valueUsd === null ? "—" : tableUsd(position.valueUsd)}
        </span>
      </button>

      {open && (
        <div className="border-t border-border bg-muted/40 px-4 py-3">
          <ul className="space-y-1.5">
            {position.components.map((c, i) => (
              <li
                key={`${c.symbol}-${i}`}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="text-sm">
                  {c.symbol}
                  {c.side && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {c.side === "long" ? "long" : "short"}
                    </span>
                  )}
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="font-mono text-sm">
                    {tableNumber(c.quantity, c.quantity >= 1000 ? 2 : 6)}
                  </span>
                  <span className="font-mono text-sm text-muted-foreground">
                    {c.valueUsd === null
                      ? `≈${NBSP}—`
                      : tableUsd(c.valueUsd, usdDecimals(c.valueUsd))}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {position.feesUsd !== null && (
            <p className="mt-2 text-xs text-muted-foreground">
              Несобранные комиссии:{" "}
              <span className="font-mono">
                {tableUsd(position.feesUsd, usdDecimals(position.feesUsd))}
              </span>{" "}
              — в стоимость позиции не входят
            </p>
          )}

          <p className="mt-2 text-xs text-muted-foreground">
            прочитано: {formatRelativeTime(position.updatedAt) ?? "—"}
            {position.walletLabel ? ` · ${position.walletLabel}` : ""}
          </p>
        </div>
      )}
    </Card>
  );
}

/** Займ: долг, привязанные позиции, дельта и управление связками. */
function BorrowCard({
  borrow,
  positions,
  busy,
  onLink,
  onUnlink,
}: {
  borrow: LeverageBorrowDto;
  positions: PositionDto[];
  busy: boolean;
  onLink: (borrowId: string, positionId: string) => void;
  onUnlink: (borrowId: string, positionId: string) => void;
}) {
  const [pick, setPick] = useState("");
  const linked = positions.filter((p) =>
    borrow.linkedPositionIds.includes(p.id),
  );
  const available = positions.filter(
    (p) => !borrow.linkedPositionIds.includes(p.id),
  );

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <div>
          <span className="text-sm font-medium">{borrow.symbol}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {chainLabel(borrow.chain)}
          </span>
        </div>
        <div className="flex items-baseline gap-3">
          <span
            className="font-mono text-sm"
            title={tableQuantity(borrow.quantity, true)}
          >
            {tableQuantity(borrow.quantity)}
          </span>
          <span className="font-mono text-sm font-semibold">
            {borrow.debtUsd === null ? "—" : tableUsd(borrow.debtUsd)}
          </span>
        </div>
      </div>

      <div className="px-4 py-3">
        {linked.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Не привязан ни к одной позиции — непонятно, во что ушли эти деньги.
          </p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {linked.map((p) => (
                <li
                  key={p.id}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="min-w-0 truncate text-sm">
                    {p.title}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {p.protocolLabel}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="font-mono text-sm">
                      {p.valueUsd === null ? "—" : tableUsd(p.valueUsd)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onUnlink(borrow.id, p.id)}
                      aria-label={`Снять привязку ${p.title}`}
                      title="Снять привязку"
                      className="h-7 px-1.5 text-muted-foreground"
                    >
                      <Link2Off className="size-3.5" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>

            <dl className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-border pt-3">
              <div className="flex items-baseline gap-2">
                <dt className={LABEL}>Позиции</dt>
                <dd className="font-mono text-sm">
                  {borrow.linkedUsd === null ? "—" : tableUsd(borrow.linkedUsd)}
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className={LABEL}>Дельта</dt>
                <dd
                  className={cn(
                    "font-mono text-sm font-semibold",
                    borrow.deltaUsd === null
                      ? "text-muted-foreground"
                      : pnlClass(borrow.deltaUsd),
                  )}
                >
                  {borrow.deltaUsd === null
                    ? "—"
                    : tableUsdSigned(
                        borrow.deltaUsd,
                        usdDecimals(borrow.deltaUsd),
                      )}
                  {borrow.deltaPct !== null && (
                    <span className="ml-1.5 text-xs">
                      ({tablePctSigned(borrow.deltaPct, 1)})
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </>
        )}

        {available.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor={`link-${borrow.id}`} className="sr-only">
              Позиция для привязки
            </label>
            <select
              id={`link-${borrow.id}`}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">Привязать позицию…</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · {p.protocolLabel} · {chainLabel(p.chain)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || pick === ""}
              onClick={() => {
                onLink(borrow.id, pick);
                setPick("");
              }}
            >
              Привязать
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
