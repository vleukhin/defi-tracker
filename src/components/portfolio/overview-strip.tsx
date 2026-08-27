"use client";

import type { ReactNode } from "react";
import { StatusChip } from "@/components/dc/chip";
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
 * Верхняя зона hero-карточки: количества базовых активов, денежный контекст
 * и Health Factor. В 1.1 количество BTC/ETH стало первым уровнем, потому что
 * именно им стратегия измеряет рост; долларовая оценка осталась контекстом.
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
function BaseAssetAmounts({ coins }: { coins: CoinAmount[] }) {
  if (coins.length === 0) {
    return <p className="t-meta text-text-3">Количество монет пока неизвестно</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4">
      {coins.map((coin) => (
        <div key={coin.key} className="min-w-0">
          <p className="t-display-sm truncate text-text-1">
            {tableNumber(coin.amount, 4)}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-1.5">
            <span className="t-label">{coin.unit}</span>
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
          </p>
        </div>
      ))}
    </div>
  );
}

export function OverviewStrip({
  overview,
  debtSummary,
  delta,
  coins,
  staleNote,
}: {
  overview: PortfolioOverviewDto;
  debtSummary: DebtSummaryDto | null;
  delta: AssetsDelta | null;
  coins: CoinAmount[];
  /** «цены 14 ч назад» — если цены устарели; null, когда всё свежо. */
  staleNote: string | null;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-9 gap-y-6 px-5 pt-[22px] pb-5 sm:px-6">
      <div className="flex min-w-[280px] flex-1 flex-col gap-3 sm:min-w-[320px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="t-label">Базовые активы</span>
          <HelpTip>{COINS_HINT}</HelpTip>
        </div>
        <BaseAssetAmounts coins={coins} />
      </div>

      <dl className="grid min-w-[280px] flex-[1.35] grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-3 xl:gap-x-[22px]">
        <HeroMetric
          label="Активы, USD"
          hint={ASSETS_HINT}
          value={overview.assetsUsd === null ? null : dcUsd(overview.assetsUsd)}
          unknownHint={ASSETS_UNKNOWN_HINT}
          note={
            <span className="flex flex-wrap items-center gap-1.5">
              {delta && (
                <span
                  className={cn(
                    "font-medium",
                    delta.absolute > 0 && "text-profit",
                    delta.absolute < 0 && "text-loss",
                    delta.absolute === 0 && "text-text-2",
                  )}
                >
                  {dcUsdSigned(delta.absolute)}
                  {delta.percent !== null &&
                    `${NBSP} · ${tablePctSigned(delta.percent, 1)}`}
                </span>
              )}
              {delta && <span>{delta.label}</span>}
              {staleNote !== null && <StatusChip tone="warn">{staleNote}</StatusChip>}
            </span>
          }
        />
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
  note,
  unknownHint = DEBT_UNREAD_HINT,
}: {
  label: string;
  hint?: ReactNode;
  /** null = величина неизвестна: «—» с подсказкой, а не ноль. */
  value: string | null;
  tone?: "profit" | "loss";
  note?: ReactNode;
  unknownHint?: string;
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
        title={value === null ? unknownHint : undefined}
      >
        {value ?? (
          <span className="inline-flex items-center gap-1.5">
            —
            <HelpTip>{unknownHint}</HelpTip>
          </span>
        )}
      </dd>
      {note && <dd className="t-meta mt-1 text-text-3">{note}</dd>}
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
