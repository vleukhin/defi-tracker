"use client";

import { Badge } from "@/components/ui/badge";
import type { PositionDto, StableBorrowRateDto } from "@/lib/api/types";
import { chainLabel, tablePct, tableSigned, tableUsd } from "@/lib/format";
import { isStableSymbol } from "@/lib/stables";
import {
  CardFooter,
  CardHead,
  CardMetric,
  CardMetrics,
  CardSection,
  OwnershipBar,
  ProtocolCard,
  ProtocolMark,
  UnmarkedBadge,
} from "./card-parts";
import { ProfitValue } from "./position-card";
import { type MarkFn } from "./shared";

/**
 * Карточка депозита Fluid.
 *
 * Депозит лендинга отличается от пула тем, что доход по нему НАЧИСЛЯЕТСЯ
 * ставкой, а не появляется из переоценки. Поэтому на карточке рядом стоят
 * два числа: ставка депозита и стоимость заемных стейблов на Aave. По
 * стратегии (docs/07 §3) депозит на стороннем лендинге держат ровно до тех
 * пор, пока первое больше второго, — до этой карточки такое сравнение
 * приходилось делать в уме, переключаясь между интерфейсами протоколов.
 *
 * Второй вопрос к депозиту — чьи в нем деньги: на Fluid лежат и собственные
 * стейблы, и часть заемных, и от этого зависит, что именно окупает ставка.
 * Полоса показывает это разделение, не заставляя читать два числа подряд.
 */

/** Фирменный синий Fluid. Только заливкой (плитка, полоса) — не текстом. */
const FLUID_ACCENT = "#2f6bff";
const FLUID_ACCENT_LIGHT = "#6d8dff";

export function FluidCard({
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
  const own = position.ownPrincipalUsd;
  const borrowed = position.borrowedPrincipalUsd;
  // Вложенное известно только когда размечены ОБЕ части: иначе непонятно,
  // доход перед нами или незаявленная заемная доля
  const principal = own !== null && borrowed !== null ? own + borrowed : null;

  // Базовая ставка без наград — уже ставка; награды без базовой — нет,
  // поэтому итог считается только от базовой
  const base = position.supplyRatePercent;
  const rewards = position.rewardsRatePercent;
  const totalRate = base === null ? null : base + (rewards ?? 0);

  // Сравнивать ставку депозита со ставкой займа в стейблах осмысленно
  // только для стейбл-депозита: ставка в ETH — про другой риск и другую
  // валюту, и правило «депозит дороже займа» на нее не распространяется
  const comparable = position.components.some((c) => isStableSymbol(c.symbol));
  const borrowRate = stableBorrow.ratePercent;
  const spread =
    totalRate !== null && borrowRate !== null ? totalRate - borrowRate : null;

  return (
    <ProtocolCard accent={FLUID_ACCENT}>
      <CardHead
        mark={<FluidMark />}
        name="Fluid"
        subtitle={
          <>
            {position.title}
            {position.subtitle && ` · ${position.subtitle}`}
            {` · ${chainLabel(position.chain)}`}
          </>
        }
        badges={<UnmarkedBadge principal={principal} />}
        position={position}
        busy={busy}
        onMark={onMark}
      />

      <CardMetrics>
        <CardMetric
          label="Стоимость"
          value={
            position.valueUsd === null ? null : tableUsd(position.valueUsd)
          }
        >
          {"доход "}
          <ProfitValue position={position} className="text-xs" />
        </CardMetric>

        <CardMetric
          label="Ставка сейчас"
          value={totalRate === null ? null : tablePct(totalRate, 2)}
          unit="годовых"
        >
          {base === null ? (
            "ставка не прочитана — обновите данные"
          ) : (
            <>
              {"база "}
              <span className="font-mono">{tablePct(base, 2)}</span>
              {rewards !== null && (
                <>
                  {" · награды "}
                  <span className="font-mono">{tablePct(rewards, 2)}</span>
                </>
              )}
            </>
          )}
        </CardMetric>
      </CardMetrics>

      <CardSection
        label="Вложено"
        value={principal === null ? null : tableUsd(principal)}
      >
        <OwnershipBar own={own} borrowed={borrowed} accent={FLUID_ACCENT} />
      </CardSection>

      {comparable && (
        <CardFooter
          title={
            <>
              {"Заём стейблов на Aave — "}
              <span className="font-mono text-foreground">
                {borrowRate === null ? "—" : tablePct(borrowRate, 2)}
              </span>
              {" годовых"}
              {stableBorrow.debtUsd > 0 && (
                <>
                  {" · долг "}
                  <span className="font-mono">
                    {tableUsd(stableBorrow.debtUsd)}
                  </span>
                </>
              )}
            </>
          }
          badge={
            spread !== null && (
              <Badge
                variant={spread > 0 ? "success" : "warning"}
                className="font-mono"
              >
                {`${tableSigned(spread, 2)} п.п.`}
              </Badge>
            )
          }
        >
          {spread === null
            ? borrowRate === null
              ? "Ставка займа не прочитана — сравнить не с чем."
              : "Ставка депозита не прочитана — сравнить не с чем."
            : spread > 0
              ? "Депозит дороже займа — заемные в нем окупаются."
              : "Депозит не дороже займа: по стратегии его держат только пока ставка выше ставки по займу."}
        </CardFooter>
      )}
    </ProtocolCard>
  );
}

/** Знак Fluid — капля в фирменном синем. */
function FluidMark() {
  return (
    <ProtocolMark from={FLUID_ACCENT} to={FLUID_ACCENT_LIGHT}>
      <path
        fill="#fff"
        d="M12 3.2c3.9 4.4 6.4 7.6 6.4 10.6a6.4 6.4 0 0 1-12.8 0c0-3 2.5-6.2 6.4-10.6z"
      />
      <path
        fill={FLUID_ACCENT}
        fillOpacity="0.35"
        d="M12 8.6c1.9 2.3 3.1 4 3.1 5.4a3.1 3.1 0 0 1-6.2 0c0-1.4 1.2-3.1 3.1-5.4z"
      />
    </ProtocolMark>
  );
}
