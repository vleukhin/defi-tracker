"use client";

import { Badge } from "@/components/ui/badge";
import type { PositionDto, StableBorrowRateDto } from "@/lib/api/types";
import { chainLabel, tablePct, tableSigned, tableUsd } from "@/lib/format";
import { isStableSymbol } from "@/lib/stables";
import { cn } from "@/lib/utils";
import { MarkPopover } from "./mark-popover";
import { ProfitValue } from "./position-card";
import { LABEL, ZoneChip, type MarkFn } from "./shared";

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
    <li
      className="overflow-hidden rounded-lg border border-border"
      style={{
        // Тинт протокола по рецепту категорийных карточек (ТЗ §5.1.3)
        background: `color-mix(in oklab, ${FLUID_ACCENT} 6%, var(--card))`,
      }}
    >
      <div className="flex items-start gap-3 p-4 pb-3">
        <FluidMark />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold">Fluid</span>
            <ZoneChip zone={position.zone} />
            {principal === null && (
              <Badge variant="warning">не размечено</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {position.title}
            {position.subtitle && ` · ${position.subtitle}`}
            {` · ${chainLabel(position.chain)}`}
          </p>
        </div>
        <MarkPopover position={position} busy={busy} onMark={onMark} />
      </div>

      <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
        <div>
          <span className={cn(LABEL, "block")}>Стоимость</span>
          <p
            className={cn(
              "mt-1 font-mono text-2xl leading-none font-semibold tracking-tight",
              position.valueUsd === null && "text-muted-foreground",
            )}
          >
            {position.valueUsd === null ? "—" : tableUsd(position.valueUsd)}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {"доход "}
            <ProfitValue position={position} className="text-xs" />
          </p>
        </div>

        <div>
          <span className={cn(LABEL, "block")}>Ставка сейчас</span>
          <p
            className={cn(
              "mt-1 font-mono text-2xl leading-none font-semibold tracking-tight",
              totalRate === null && "text-muted-foreground",
            )}
          >
            {totalRate === null ? "—" : tablePct(totalRate, 2)}
            {totalRate !== null && (
              <span className="ml-1.5 font-sans text-xs font-normal text-muted-foreground">
                годовых
              </span>
            )}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
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
          </p>
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className={LABEL}>Вложено</span>
          {/* При неразмеченной позиции числа нет, а прочерк рядом
              с объяснением ниже — просто шум */}
          {principal !== null && (
            <span className="font-mono text-sm font-semibold">
              {tableUsd(principal)}
            </span>
          )}
        </div>
        <OwnershipBar own={own} borrowed={borrowed} />
      </div>

      {comparable && (
        <div className="border-t border-border/60 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-xs text-muted-foreground">
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
            </span>
            {spread !== null && (
              <Badge
                variant={spread > 0 ? "success" : "warning"}
                className="font-mono"
              >
                {`${tableSigned(spread, 2)} п.п.`}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {spread === null
              ? borrowRate === null
                ? "Ставка займа не прочитана — сравнить не с чем."
                : "Ставка депозита не прочитана — сравнить не с чем."
              : spread > 0
                ? "Депозит дороже займа — заемные в нем окупаются."
                : "Депозит не дороже займа: по стратегии его держат только пока ставка выше ставки по займу."}
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * Свои и заемные в позиции. Разделение задает разметка, а не протокол:
 * на депозите лежат и собственные стейблы, и часть заемных, и различить
 * их вычитанием нельзя (docs/07 §10.1).
 */
function OwnershipBar({
  own,
  borrowed,
}: {
  own: number | null;
  borrowed: number | null;
}) {
  const principal = own !== null && borrowed !== null ? own + borrowed : null;

  if (principal === null) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Своё и заёмное не размечены — доход и собственная доля не считаются.
        Разметка в кнопке справа сверху.
      </p>
    );
  }

  if (principal === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Вложено ноль: позиция размечена как пустая.
      </p>
    );
  }

  const ownPct = (own! / principal) * 100;
  const borrowedPct = 100 - ownPct;

  return (
    <>
      <div
        className="mt-2 flex h-3 gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={`Вложено своих ${tableUsd(own!)} (${tablePct(ownPct, 1)}), заемных ${tableUsd(borrowed!)} (${tablePct(borrowedPct, 1)})`}
      >
        {/* Сегмент < 1% получает минимальную ширину, иначе он исчезает */}
        <span
          className="rounded-l-full transition-[width] duration-400 ease-out"
          style={{
            width: `${ownPct}%`,
            minWidth: ownPct > 0 ? 4 : 0,
            background: FLUID_ACCENT,
          }}
        />
        <span
          className="rounded-r-full transition-[width] duration-400 ease-out"
          style={{
            width: `${borrowedPct}%`,
            minWidth: borrowedPct > 0 ? 4 : 0,
            background: "var(--color-muted-foreground)",
          }}
        />
      </div>

      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Legend
          color={FLUID_ACCENT}
          label="свои"
          valueUsd={own!}
          percent={ownPct}
        />
        <Legend
          color="var(--color-muted-foreground)"
          label="заемные"
          valueUsd={borrowed!}
          percent={borrowedPct}
        />
      </dl>
    </>
  );
}

function Legend({
  color,
  label,
  valueUsd,
  percent,
}: {
  color: string;
  label: string;
  valueUsd: number;
  percent: number;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        aria-hidden
        className="size-2 shrink-0 translate-y-px rounded-full"
        style={{ background: color }}
      />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">
        {tableUsd(valueUsd)}
        <span className="ml-1 text-muted-foreground">
          {tablePct(percent, 0)}
        </span>
      </dd>
    </div>
  );
}

/**
 * Знак Fluid — капля в фирменном синем, инлайновый SVG: страница не ходит
 * за внешними ассетами, и в темной теме знак не требует отдельного файла.
 */
function FluidMark() {
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-lg"
      style={{
        background: `linear-gradient(135deg, ${FLUID_ACCENT}, ${FLUID_ACCENT_LIGHT})`,
      }}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="#fff">
        <path d="M12 3.2c3.9 4.4 6.4 7.6 6.4 10.6a6.4 6.4 0 0 1-12.8 0c0-3 2.5-6.2 6.4-10.6z" />
        <path
          d="M12 8.6c1.9 2.3 3.1 4 3.1 5.4a3.1 3.1 0 0 1-6.2 0c0-1.4 1.2-3.1 3.1-5.4z"
          fill={FLUID_ACCENT}
          fillOpacity="0.35"
        />
      </svg>
    </span>
  );
}
