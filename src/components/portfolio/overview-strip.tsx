"use client";

import type { ReactNode } from "react";
import { HelpTip } from "@/components/dc/help-tip";
import { DEBT_UNREAD_HINT, formatHf, formatHfThreshold } from "@/components/debt/hf";
import { hfTone } from "@/components/debt/risk";
import type { DebtSummaryDto, PortfolioOverviewDto } from "@/lib/api/types";
import {
  NBSP,
  dcUsd,
  dcUsdSigned,
  tableNumber,
  tablePctSigned,
  tableSigned,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Верхняя зона hero-карточки: связка пяти чисел и Health Factor.
 *
 * Порознь эти числа на вопрос «сколько я заработал» не отвечают, поэтому
 * они стоят одной строкой. Крупное здесь ровно одно — «Активы» (§1.1):
 * остальные четыре набраны 19px, и иерархия читается без подписей.
 *
 * null никогда не выдаётся за ноль: «долг ни разу не прочитан» рисуется
 * «—» с подсказкой, а не «$0».
 */

const ASSETS_HINT =
  "Стоимость всего, чем вы владеете: свои средства плюс заёмные, размещённые в позициях.";
const ASSETS_UNKNOWN_HINT =
  "Стоимость части размещённых позиций неизвестна — сумма не выводится";
const NET_HINT =
  "Активы минус долг — сколько останется, если закрыть все займы.";
const PROFIT_HINT =
  "Чистая стоимость минус внесённые собственные деньги. Заёмные средства и доход от них во «Внесено» не попадают.";
const DEPOSITED_HINT =
  "Сумма собственных денег, заведённых в портфель, по журналу депозитов. Заёмные сюда не попадают — иначе заём выглядел бы вложением.";

/** Дельта «Активов» за период: считается там, где есть история снепшотов. */
export interface AssetsDelta {
  absolute: number;
  percent: number | null;
  label: string;
}

/**
 * Количество монеты для строки под «Активами».
 * `change` — изменение за окно снепшотов; null, если истории не хватает.
 */
export interface CoinAmount {
  key: string;
  unit: string;
  amount: number;
  change: number | null;
}

const COINS_HINT =
  "Главная метрика стратегии — сколько монет, а не сколько долларов: на цену повлиять нельзя, на количество можно. Изменение считается за то же окно, что и дельта активов.";

/**
 * Количества BTC и ETH — строка под «Активами».
 *
 * Стоит здесь, а не в разрезе «Активы», намеренно: разрезов три, режим по
 * умолчанию — «Зоны», и в нём количеств не было вовсе. Стратегия (docs/07
 * §4) называет их главной метрикой, поэтому они не должны зависеть от
 * выбранной проекции и не должны уезжать за сгиб экрана.
 *
 * Стейблы сюда не попадают: их «количество» и есть доллары, а вопрос
 * «стало ли монет больше» к ним не относится.
 */
function CoinAmounts({ coins }: { coins: CoinAmount[] }) {
  if (coins.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {coins.map((coin) => (
        <span key={coin.key} className="flex items-baseline gap-1.5">
          <span className="font-mono text-[15px] text-text-1">
            {tableNumber(coin.amount, 4)}
          </span>
          <span className="text-[12px] text-text-3">{coin.unit}</span>
          {coin.change !== null && coin.change !== 0 && (
            <span
              className={cn(
                "font-mono text-[12px]",
                coin.change > 0 ? "text-profit" : "text-loss",
              )}
            >
              {tableSigned(coin.change, 4)}
            </span>
          )}
        </span>
      ))}
      <HelpTip>{COINS_HINT}</HelpTip>
    </div>
  );
}

export function OverviewStrip({
  overview,
  debtSummary,
  delta,
  coins,
}: {
  overview: PortfolioOverviewDto;
  debtSummary: DebtSummaryDto | null;
  delta: AssetsDelta | null;
  coins: CoinAmount[];
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-10 gap-y-6 px-5 pt-[22px] pb-5 sm:px-6">
      <div className="flex min-w-[230px] flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="t-label">Активы</span>
          <HelpTip>{ASSETS_HINT}</HelpTip>
        </div>
        {/* До sm число набирается ролью 34px: 42px Mono на 360px съедают
            288px доступной ширины, и семизначная сумма упирается в край */}
        <p
          className={cn(
            "t-display-sm sm:t-display",
            overview.assetsUsd === null && "text-text-3",
          )}
          title={overview.assetsUsd === null ? ASSETS_UNKNOWN_HINT : undefined}
        >
          {overview.assetsUsd === null ? "—" : dcUsd(overview.assetsUsd)}
        </p>
        {/* Прочерк без объяснения — это вопрос без ответа. title его давал
            только под мышью, поэтому причина вынесена в «?» */}
        {overview.assetsUsd === null && (
          <p className="t-meta flex items-center gap-1.5 text-text-3">
            величина неизвестна
            <HelpTip>{ASSETS_UNKNOWN_HINT}</HelpTip>
          </p>
        )}
        <CoinAmounts coins={coins} />
        {delta && (
          <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span
              className={cn(
                "font-medium",
                delta.absolute > 0 && "text-profit",
                delta.absolute < 0 && "text-loss",
                delta.absolute === 0 && "text-text-2",
              )}
            >
              {/* Дельта — через точку-разделитель, без скобок (§4):
                  в скобках процент читался бы как второстепенный,
                  а он здесь не менее важен, чем сумма */}
              {dcUsdSigned(delta.absolute)}
              {delta.percent !== null &&
                `${NBSP}·${NBSP}${tablePctSigned(delta.percent, 1)}`}
            </span>
            <span className="text-text-3">{delta.label}</span>
          </p>
        )}
      </div>

      {/* 1280 и ниже: четыре метрики складываются в две колонки (§6) */}
      <dl className="grid min-w-[240px] flex-1 grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-4 xl:gap-x-[22px]">
        <HeroMetric
          label="Долг"
          value={overview.debtUsd === null ? null : dcUsd(overview.debtUsd)}
        />
        <HeroMetric
          label="Чистая"
          hint={NET_HINT}
          value={overview.netUsd === null ? null : dcUsd(overview.netUsd)}
        />
        <HeroMetric
          label="Внесено"
          hint={DEPOSITED_HINT}
          value={dcUsd(overview.depositedUsd)}
        />
        <HeroMetric
          label="Прибыль"
          hint={PROFIT_HINT}
          value={
            overview.profitUsd === null ? null : dcUsdSigned(overview.profitUsd)
          }
          tone={
            overview.profitUsd === null || overview.profitUsd === 0
              ? undefined
              : overview.profitUsd > 0
                ? "profit"
                : "loss"
          }
        />
      </dl>

      <HealthFactor summary={debtSummary} />
    </div>
  );
}

/** Ячейка связки: подпись → значение 19px. Третьего уровня здесь нет. */
function HeroMetric({
  label,
  hint,
  value,
  tone,
}: {
  label: string;
  hint?: ReactNode;
  /** null = величина неизвестна: «—» с подсказкой, а не ноль. */
  value: string | null;
  tone?: "profit" | "loss";
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5">
        <span className="t-label truncate">{label}</span>
        {hint && <HelpTip>{hint}</HelpTip>}
      </dt>
      <dd
        className={cn(
          "t-metric-sm mt-1 whitespace-nowrap",
          value === null && "text-text-3",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss",
        )}
        title={value === null ? DEBT_UNREAD_HINT : undefined}
      >
        {value ?? (
          <span className="inline-flex items-center gap-1.5">
            —
            <HelpTip>{DEBT_UNREAD_HINT}</HelpTip>
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * Health Factor — единственный сценарий, способный принудительно прервать
 * стратегию, поэтому он на экране всегда. Цвет здесь семантический
 * законно: это статус риска, а не украшение.
 */
function HealthFactor({ summary }: { summary: DebtSummaryDto | null }) {
  if (!summary) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="t-label">Health Factor</span>
        <span
          className="flex h-[28px] items-center gap-1.5 rounded-control bg-chip px-2.5 font-mono text-[15px] text-text-3"
          title={DEBT_UNREAD_HINT}
        >
          —
          <HelpTip>{DEBT_UNREAD_HINT}</HelpTip>
        </span>
      </div>
    );
  }

  const hf = summary.minHealthFactor;
  const threshold = summary.hfWarningThreshold;
  // Раньше здесь стоял хардкод «hf < 1.2» мимо HF_CRITICAL и мимо общей
  // шкалы зон: hero расходился с «Долгом» и «Зонами» на тех же числах
  const tone = hfTone(hf, threshold) ?? "profit";
  const color = `var(--${tone})`;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="t-label">Health Factor</span>
      <span
        className="flex items-center gap-2 rounded-control py-[5px] pr-2.5 pl-2"
        style={{
          background: `color-mix(in srgb, ${color} 8%, transparent)`,
          boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 20%, transparent)`,
        }}
      >
        <span
          aria-hidden
          className="size-[6px] shrink-0 rounded-full"
          style={{ background: color }}
        />
        <span
          className="font-mono text-[15px] font-medium leading-none"
          style={{ color }}
        >
          {formatHf(hf)}
        </span>
        <span
          className="text-[11.5px] leading-none opacity-75"
          style={{ color }}
        >
          {hf === null ? "долга нет" : `порог ${formatHfThreshold(threshold)}`}
        </span>
      </span>
    </div>
  );
}
