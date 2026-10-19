"use client";

import { Verdict } from "@/components/dc/card";
import { Chip, StatusChip } from "@/components/dc/chip";
import { Metric } from "@/components/dc/metrics";
import { countLabel } from "@/components/portfolio/plural";
import type { PendleDetailsDto, PositionDto } from "@/lib/api/types";
import { chainLabel, dcRate, dcTokens, dcUsd, tableDate } from "@/lib/format";
import { maturityDecision, type MaturityDecision } from "@/lib/positions/maturity";
import {
  CardHead,
  MetricRow,
  ownershipDelta,
  PositionShell,
  principalOf,
  profitDelta,
  UnmarkedChip,
} from "./card-parts";
import { MarkPopover } from "./mark-popover";
import { type MarkFn } from "./shared";

const TOKEN_CHIP: Record<PendleDetailsDto["tokenType"], string> = {
  pt: "PT",
  yt: "YT",
  lp: "LP",
};

/**
 * Карточка позиции Pendle: PT — зона Stability, YT и LP — Yield.
 *
 * Главный вопрос к токену Pendle — не «сколько стоит», а «когда и во что
 * превратится». У PT ответ известен заранее: к дате погашения он становится
 * базовым активом 1:1, и дисконт сегодня — это и есть зафиксированная
 * доходность. Поэтому в метриках рядом со стоимостью стоят дата погашения
 * и курс к активу, а не ставка: implied APY рынка — доходность для того,
 * кто покупает СЕЙЧАС, и выдавать ее за доход этой позиции было бы ошибкой.
 *
 * Визуалов, как у депозита Fluid, нет: состав одномерный — один актив,
 * в котором выражен курс.
 */
export function PendleCard({
  position,
  busy,
  onMark,
  nowMs,
}: {
  position: PositionDto;
  busy: boolean;
  onMark: MarkFn;
  nowMs: number;
}) {
  const pendle = position.pendle;
  const principal = principalOf(position);
  const decision = pendle ? maturityDecision(pendle.expiry, nowMs) : null;
  const tokenLabel = pendle ? TOKEN_CHIP[pendle.tokenType] : "Pendle";
  const asset = pendle?.assetSymbol ?? null;

  return (
    <PositionShell>
      <CardHead
        protocol="pendle"
        name="Pendle"
        zone={position.zone}
        kind={
          <>
            <Chip>{tokenLabel}</Chip>
            <UnmarkedChip position={position} />
          </>
        }
        meta={[position.title, position.subtitle, chainLabel(position.chain)]}
        status={<MaturityStatus decision={decision} />}
        menu={<MarkPopover position={position} busy={busy} onMark={onMark} />}
      />

      <MetricRow>
        <Metric
          label="Стоимость"
          value={position.valueUsd === null ? null : dcUsd(position.valueUsd)}
          delta={
            position.valueUsd === null
              ? asset === null
                ? "актив SY не прочитан — оценки нет"
                : `нет цены ${asset} или курса оракула`
              : profitDelta(position)
          }
        />
        <Metric
          label="Погашение"
          value={pendle ? tableDate(pendle.expiry) : null}
          mono={false}
          delta={maturityDelta(decision)}
        />
        <Metric
          label="Курс к активу"
          hint="Сколько базового актива стоит один токен по оракулу Pendle (TWAP 15 минут). PT к погашению сходится к 1, YT — к нулю."
          value={
            pendle?.rateToAsset === null || pendle === null || asset === null
              ? null
              : dcTokens(pendle.rateToAsset, asset)
          }
          delta={rateDelta(pendle)}
        />
        <Metric
          label="Вложено"
          value={principal === null ? null : dcUsd(principal)}
          delta={ownershipDelta(position)}
        />
      </MetricRow>

      <Verdict>{verdictText(pendle, decision, asset)}</Verdict>
    </PositionShell>
  );
}

function MaturityStatus({ decision }: { decision: MaturityDecision | null }) {
  if (decision === null) return null;
  if (decision.matured) return <StatusChip tone="warn">погашено</StatusChip>;
  if (decision.soon) {
    return (
      <StatusChip tone="warn">
        {countLabel(decision.daysLeft, "день", "дня", "дней")}
      </StatusChip>
    );
  }
  return null;
}

function maturityDelta(decision: MaturityDecision | null): string {
  if (decision === null) return "дата погашения не прочитана";
  if (decision.matured) {
    return decision.daysSince === 0
      ? "погашен сегодня"
      : `погашен ${countLabel(decision.daysSince, "день", "дня", "дней")} назад`;
  }
  return `через ${countLabel(decision.daysLeft, "день", "дня", "дней")}`;
}

function rateDelta(pendle: PendleDetailsDto | null): string {
  if (pendle === null) return "—";
  if (pendle.rateToAsset === null) return "оракул не ответил — обновите данные";
  const implied =
    pendle.impliedApyPercent === null ? null : `рынок ${dcRate(pendle.impliedApyPercent)}`;
  const underlying =
    pendle.underlyingApyPercent === null
      ? null
      : `база ${dcRate(pendle.underlyingApyPercent)}`;
  return [implied, underlying].filter(Boolean).join(" · ") || "TWAP 15 минут";
}

function verdictText(
  pendle: PendleDetailsDto | null,
  decision: MaturityDecision | null,
  asset: string | null,
): string {
  const target = asset ?? "базовый актив";
  if (pendle === null || decision === null) {
    return "Позиция Pendle без данных рынка — обновите чтение.";
  }
  if (decision.matured) {
    if (pendle.tokenType === "pt") {
      return `Срок наступил: PT обменивается на ${target} 1:1 — решить, в какую зону идут средства.`;
    }
    if (pendle.tokenType === "yt") {
      return "YT погашен и больше не начисляет доход — забрать начисленное.";
    }
    return "Рынок погашен: половина ликвидности — погашенный PT, позицию пора вывести.";
  }
  if (pendle.tokenType === "pt") {
    return `Фиксированная доходность: к погашению PT превратится в ${target} 1:1, дисконт сегодня — заработок до срока.`;
  }
  if (pendle.tokenType === "yt") {
    return "YT — ставка на доходность базового актива до погашения; к сроку его стоимость сходится к нулю.";
  }
  return "LP зарабатывает на комиссиях и доходе базового актива; к погашению PT внутри пула сходится к активу.";
}
