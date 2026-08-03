"use client";

import { Verdict } from "@/components/dc/card";
import { Metric } from "@/components/dc/metrics";
import type { PositionDto, StableBorrowRateDto } from "@/lib/api/types";
import { chainLabel, dcUsd } from "@/lib/format";
import {
  CardHead,
  MetricRow,
  ownershipDelta,
  PositionShell,
  principalOf,
  profitDelta,
  UnmarkedChip,
} from "./card-parts";
import { FluidCard } from "./fluid-card";
import { GmxCard } from "./gmx-card";
import { MarkPopover } from "./mark-popover";
import { type MarkFn } from "./shared";
import { UniswapCard } from "./uniswap-card";

/**
 * Карточка позиции. Каркас у всех типов один (см. card-parts.tsx),
 * разбор идёт по протоколу: у депозита лендинга и у пула ликвидности
 * разные вопросы к позиции, и общий набор метрик отвечал на них
 * одинаково плохо — Fluid живёт ставкой, LP диапазоном, а GM переоценкой.
 *
 * Третий тип из дизайна — заём — в списке позиций не приходит: в модели
 * данных это долговая строка Aave. Его карточка лежит рядом
 * (aave-card.tsx) и собирается из ответа /api/debt.
 */
export function PositionCard({
  position,
  positions,
  busy,
  onMark,
  stableBorrow,
  nowMs,
}: {
  position: PositionDto;
  /** Все позиции экрана: доля GM-пула считается относительно соседей. */
  positions: PositionDto[];
  busy: boolean;
  onMark: MarkFn;
  stableBorrow: StableBorrowRateDto;
  /** «Сейчас» для таймеров карточек — одно на весь список. */
  nowMs: number;
}) {
  if (position.protocol === "fluid") {
    return (
      <FluidCard
        position={position}
        busy={busy}
        onMark={onMark}
        stableBorrow={stableBorrow}
      />
    );
  }
  if (position.protocol === "uni_v3") {
    return (
      <UniswapCard
        position={position}
        busy={busy}
        onMark={onMark}
        nowMs={nowMs}
      />
    );
  }
  if (position.protocol === "gmx_v2") {
    return (
      <GmxCard
        position={position}
        positions={positions}
        busy={busy}
        onMark={onMark}
      />
    );
  }
  return <GenericCard position={position} busy={busy} onMark={onMark} />;
}

/**
 * Позиция без своей карточки: тот же каркас, только три метрики вместо
 * четырёх. Строка читателя с незнакомым протоколом должна показываться,
 * а не пропадать.
 */
function GenericCard({
  position,
  busy,
  onMark,
}: {
  position: PositionDto;
  busy: boolean;
  onMark: MarkFn;
}) {
  const principal = principalOf(position);
  const withdrawn = position.withdrawnUsd;

  return (
    <PositionShell>
      <CardHead
        protocol={position.protocol}
        name={position.protocolLabel}
        zone={position.zone}
        kind={<UnmarkedChip position={position} />}
        meta={[position.title, position.subtitle, chainLabel(position.chain)]}
        menu={<MarkPopover position={position} busy={busy} onMark={onMark} />}
      />

      <MetricRow>
        <Metric
          label="Стоимость"
          value={position.valueUsd === null ? null : dcUsd(position.valueUsd)}
          delta={profitDelta(position)}
        />
        <Metric
          label="Вложено"
          value={principal === null ? null : dcUsd(principal)}
          delta={ownershipDelta(position)}
        />
        <Metric
          label="Своих сейчас"
          hint="Текущая собственная доля стоимости позиции: доход и убыток относятся на своё и заёмное пропорционально вложенному."
          value={
            position.ownCurrentUsd === null
              ? null
              : dcUsd(position.ownCurrentUsd)
          }
          delta="из них складывается категория «Стейблы»"
        />
        <Metric
          label="Выведено"
          value={withdrawn === null ? null : dcUsd(withdrawn)}
          delta="входит в доход позиции"
        />
      </MetricRow>

      <Verdict>
        Протокол читается без своей карточки — видно разметку и доход, но не
        устройство позиции.
      </Verdict>
    </PositionShell>
  );
}
