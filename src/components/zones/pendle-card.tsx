"use client";

import type { ReactNode } from "react";
import { TimelineBar } from "@/components/dc/bar";
import { Verdict } from "@/components/dc/card";
import { Chip, StatusChip } from "@/components/dc/chip";
import { Metric } from "@/components/dc/metrics";
import { countLabel } from "@/components/portfolio/plural";
import type { PendleDetailsDto, PositionDto } from "@/lib/api/types";
import { chainLabel, dcRate, dcTokens, dcUsd, tableDate } from "@/lib/format";
import {
  maturityDecision,
  maturityProgress,
  type MaturityDecision,
} from "@/lib/positions/maturity";
import {
  CardHead,
  MetaMono,
  MetricRow,
  ownershipDelta,
  PlainBlock,
  PositionShell,
  principalOf,
  profitDelta,
  tokenQuantity,
  UnmarkedChip,
  VisualHead,
  VisualRow,
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
 * Визуал один — шкала срока: от покупки до погашения, с маркером
 * «сейчас». Состава как у пула нет: актив один, полоса из одного сегмента
 * была бы украшением, а срок — то, ради чего на карточку и смотрят.
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
        meta={[
          position.title,
          position.subtitle,
          heldMeta(position, tokenLabel),
          chainLabel(position.chain),
        ]}
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

      {pendle !== null && (
        <MaturityTimeline
          start={pendle.heldSince}
          expiry={pendle.expiry}
          zone={position.zone}
          nowMs={nowMs}
        />
      )}

      <Verdict>{verdictText(pendle, decision, asset)}</Verdict>
    </PositionShell>
  );
}

/**
 * Сколько токенов на руках и сколько это базового актива сейчас.
 *
 * Доллары отвечают «сколько стоит», а держат позицию Pendle ради штук:
 * к погашению PT меняется на актив 1:1, и «сколько получу» считается
 * от количества, а не от текущей оценки. Эквивалент — то же количество
 * по курсу оракула на момент чтения, поэтому «≈», а не «=»: курс живой
 * и у YT к сроку уходит в ноль.
 *
 * Курса нет — показываем одни штуки: выдумывать эквивалент нельзя,
 * а количество на руках известно и без оракула.
 */
function heldMeta(position: PositionDto, label: string): ReactNode | null {
  const held = position.quantity === null ? null : Number(position.quantity);
  if (held === null || !Number.isFinite(held)) return null;
  const asset = position.components[0] ?? null;
  return (
    <>
      <span className="whitespace-nowrap">
        <MetaMono>{tokenQuantity(held)}</MetaMono>
        {` ${label}`}
      </span>
      {asset !== null && (
        <>
          {" ≈ "}
          <span className="whitespace-nowrap">
            <MetaMono>{tokenQuantity(asset.quantity)}</MetaMono>
            {` ${asset.symbol}`}
          </span>
        </>
      )}
    </>
  );
}

/** Шкала «покупка → погашение» с маркером «сейчас». */
function MaturityTimeline({
  start,
  expiry,
  zone,
  nowMs,
}: {
  start: string | null;
  expiry: string;
  zone: PositionDto["zone"];
  nowMs: number;
}) {
  const progress = maturityProgress(start, expiry, nowMs);
  if (start === null || progress === null) {
    return (
      <VisualRow>
        <PlainBlock label="Срок до погашения">
          Дата покупки ещё не найдена в истории переводов — шкала появится
          после обновления.
        </PlainBlock>
      </VisualRow>
    );
  }
  const percent = progress.fraction * 100;
  const note =
    progress.fraction >= 1
      ? "срок пройден"
      : `${progress.elapsedDays} из ${countLabel(progress.totalDays, "дня", "дней", "дней")} · ${Math.round(percent)}%`;
  return (
    <>
      <VisualHead className="border-line border-t" label="Срок до погашения" note={note} />
      <TimelineBar
        className="pt-2.5"
        percent={percent}
        color={`var(--zone-${zone})`}
        ariaLabel={`Пройдено ${Math.round(percent)}% срока до погашения ${tableDate(expiry)}`}
        labels={
          <>
            <span>покупка {tableDate(start)}</span>
            <span>погашение {tableDate(expiry)}</span>
          </>
        }
      />
    </>
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
