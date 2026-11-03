"use client";

import { Verdict } from "@/components/dc/card";
import { Chip, StatusChip } from "@/components/dc/chip";
import { Metric } from "@/components/dc/metrics";
import type { PositionDto, StableBorrowRateDto } from "@/lib/api/types";
import { chainLabel, dcRate, dcUsd, tableSigned } from "@/lib/format";
import { isStableSymbol } from "@/lib/stables";
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

/**
 * Карточка депозита лендинга — тип «депозит». Обслуживает Fluid и депозит
 * стейблов на Aave: оба держат обычный баланс токена и начисляют доход
 * СТАВКОЙ, а не переоценкой, поэтому вопрос к ним один и тот же.
 *
 * Поэтому в метриках рядом стоят ставка депозита и её разница со ставкой
 * заёмных стейблов на Aave: по стратегии (docs/07 §3) депозит на лендинге
 * держат ровно до тех пор, пока первая больше второй, — до этой карточки
 * такое сравнение приходилось делать в уме, переключаясь между
 * интерфейсами протоколов.
 *
 * Протокол берётся из позиции, а не прибит к Fluid: депозит стейблов на
 * Aave — тот же инструмент, и вторая копия карточки разошлась бы с этой
 * на первой же правке. Чем депозит на Aave отличается — тем, что он бывает
 * залогом и держит health factor, — сказано подписью позиции
 * («Депозит в залоге», positions/positions.ts).
 *
 * Визуалов у депозита нет: делить нечего — состав одномерный, а «чьи
 * деньги» умещается в третий уровень ячейки «Вложено». Полоса из одного
 * сегмента не данные, а украшение.
 */
export function DepositCard({
  position,
  busy,
  onMark,
  stableBorrow,
}: {
  position: PositionDto;
  busy: boolean;
  onMark: MarkFn;
  stableBorrow: StableBorrowRateDto;
}) {
  const principal = principalOf(position);

  // Базовая ставка без наград — уже ставка; награды без базовой — нет,
  // поэтому итог считается только от базовой
  const base = position.supplyRatePercent;
  const rewards = position.rewardsRatePercent;
  const totalRate = base === null ? null : base + (rewards ?? 0);

  // Сравнивать ставку депозита со ставкой займа в стейблах осмысленно
  // только для стейбл-депозита: ставка в ETH — про другой риск и другую
  // валюту, и правило «депозит дороже займа» на неё не распространяется
  const comparable = position.components.some((c) => isStableSymbol(c.symbol));
  const borrowRate = stableBorrow.ratePercent;
  const spread =
    comparable && totalRate !== null && borrowRate !== null
      ? totalRate - borrowRate
      : null;
  const borrowed = position.borrowedPrincipalUsd ?? 0;

  return (
    <PositionShell>
      <CardHead
        protocol={position.protocol}
        name={position.protocolLabel}
        zone={position.zone}
        kind={<UnmarkedChip position={position} />}
        meta={[position.title, position.subtitle, chainLabel(position.chain)]}
        status={
          spread === null ? undefined : (
            <StatusChip tone={spread > 0 ? "profit" : "loss"}>
              {`${tableSigned(spread, 2)}%`}
            </StatusChip>
          )
        }
        menu={<MarkPopover position={position} busy={busy} onMark={onMark} />}
      />

      <MetricRow>
        <Metric
          label="Стоимость"
          value={position.valueUsd === null ? null : dcUsd(position.valueUsd)}
          delta={profitDelta(position)}
        />
        <Metric
          label="Ставка сейчас"
          value={totalRate === null ? null : dcRate(totalRate)}
          mono={false}
          delta={
            base === null
              ? "ставка не прочитана — обновите данные"
              : // Награды читаются не у всякого протокола: у Aave кампании
                // Merit идут вне рынка, и «награды 0,00%» было бы выдумкой
                rewards === null
                ? `база ${dcRate(base)} · награды не читаются`
                : `база ${dcRate(base)} · награды ${dcRate(rewards)}`
          }
        />
        <Metric
          label="Вложено"
          value={principal === null ? null : dcUsd(principal)}
          delta={ownershipDelta(position)}
        />
        <Metric
          label="Спред к займу"
          hint="Ставка депозита минус ставка заёмных стейблов на Aave. Пока спред положительный, заёмные в позиции окупаются."
          value={spread === null ? null : `${tableSigned(spread, 2)}%`}
          mono={false}
          tone={spread === null ? undefined : spread > 0 ? "profit" : "loss"}
          delta={
            spread === null
              ? comparable
                ? "сравнить не с чем — ставка не прочитана"
                : "депозит не в стейблах — сравнения нет"
              : `годовых · заём ${borrowRate === null ? "—" : dcRate(borrowRate)}`
          }
        />
      </MetricRow>

      <Verdict
        chip={borrowed > 0 ? <Chip>связано с займом на Aave</Chip> : undefined}
      >
        {spread === null
          ? comparable
            ? "Ставку сравнить не с чем — одна из двух не прочитана."
            : "Депозит не в стейблах: правило «дороже займа» на него не распространяется."
          : spread > 0
            ? "Депозит дороже займа — заёмные в нём окупаются."
            : "Депозит не дороже займа: по стратегии его держат, только пока ставка выше ставки по займу."}
      </Verdict>
    </PositionShell>
  );
}
