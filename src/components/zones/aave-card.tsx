"use client";

import type { ReactNode } from "react";
import { SafetyBar } from "@/components/dc/bar";
import { Verdict } from "@/components/dc/card";
import { Chip, StatusChip, type StatusTone } from "@/components/dc/chip";
import { Metric } from "@/components/dc/metrics";
import { formatHf, formatHfThreshold, hfStatus } from "@/components/debt/hf";
import type { DebtChainDto, StrategyZone } from "@/lib/api/types";
import { chainLabel, dcRate, dcUsd, tablePct, tablePctSigned } from "@/lib/format";
import { CardHead, MetricRow, PositionShell, VisualHead } from "./card-parts";

/**
 * Карточка займа Aave v3 — третий тип позиции, зона Growth.
 *
 * Заём не приходит в списке позиций (`PositionProtocol` знает только
 * fluid / gmx_v2 / uni_v3): в модели данных это долговая строка, и живёт
 * она в ответе GET /api/debt. Поэтому карточка не берёт PositionDto,
 * а собирается из сети долга — экран отдаёт ей `DebtChainDto`, порог HF
 * из настроек и ставку заёмных стейблов.
 *
 * Вопрос к займу один: сколько осталось до ликвидации. Ликвидация —
 * единственный сценарий, способный принудительно прервать стратегию
 * накопления, поэтому запас показан дважды: числом «на сколько может
 * упасть залог» и полосой прочности с порогом предупреждения.
 *
 * Лимит LTV и запас по падению API не отдаёт — оба выводятся из HF:
 * HF = залог × порог_ликвидации / долг, значит порог_ликвидации =
 * HF × LTV, а ликвидация наступает при падении залога в HF раз.
 * Кнопки разметки у карточки нет: заём не размечают — зона у него
 * по стратегии одна.
 */

export interface LoanCardProps {
  /** Долг по сети: totals и HF из оракула Aave, разбивка по v-токенам. */
  chain: DebtChainDto;
  /** Порог предупреждения HF из настроек (SettingsDto.hfWarningThreshold). */
  hfWarningThreshold: number;
  /** Ставка заёмных стейблов, % годовых; null = не прочитана. */
  borrowRatePercent?: number | null;
  /** Из чего состоит залог: «WBTC + WETH». Списка залога в /api/debt нет. */
  collateralLabel?: ReactNode;
  /** Количества залога в третьем уровне ячейки: «1,2610 BTC · 16,9154 ETH». */
  collateralDelta?: ReactNode;
  /** Куда ушли заёмные — знает экран, а не карточка. */
  verdict?: ReactNode;
  /** По стратегии залог живёт в Growth; зона оставлена настраиваемой. */
  zone?: StrategyZone;
  as?: "li" | "article";
}

export function AaveCard({
  chain,
  hfWarningThreshold,
  borrowRatePercent = null,
  collateralLabel,
  collateralDelta,
  verdict,
  zone = "growth",
  as = "li",
}: LoanCardProps) {
  const collateral = chain.totalCollateralUsd;
  const debt = chain.totalDebtUsd;
  const hf = chain.healthFactor;
  // utilization = долг / залог; в процентах это и есть LTV позиции
  const ltvPercent = chain.utilization === null ? null : chain.utilization * 100;
  // Порог ликвидации в модели Aave: HF = залог × порог / долг
  const limitPercent = hf === null || ltvPercent === null ? null : hf * ltvPercent;
  // Ликвидация приходит, когда залог обесценится в HF раз
  const dropPercent = hf === null || hf <= 0 ? null : -(1 - 1 / hf) * 100;

  const status = hfStatus(hf, hfWarningThreshold);
  const tone: StatusTone =
    status === "below" ? "loss" : status === "warning" ? "warn" : "profit";

  const debtSymbols = Array.from(new Set(chain.items.map((i) => i.symbol)));

  return (
    <PositionShell as={as}>
      <CardHead
        protocol="aave"
        name="Aave v3"
        zone={zone}
        kind={<Chip>займ</Chip>}
        meta={[
          collateralLabel != null ? <>залог {collateralLabel}</> : null,
          debtSymbols.length > 0 ? `долг ${debtSymbols.join(" + ")}` : null,
          chainLabel(chain.chain),
        ]}
        status={
          hf === null ? undefined : (
            <StatusChip tone={tone}>{`HF ${formatHf(hf)}`}</StatusChip>
          )
        }
      />

      <MetricRow>
        <Metric
          label="Залог"
          value={collateral === null ? null : dcUsd(collateral)}
          delta={collateralDelta ?? "под займ на Aave"}
        />
        <Metric
          label="Долг"
          value={debt === null ? null : dcUsd(debt)}
          delta={
            borrowRatePercent === null
              ? "ставка не прочитана"
              : `ставка ${dcRate(borrowRatePercent)} годовых`
          }
        />
        <Metric
          label="LTV"
          hint="Долг к стоимости залога. Ликвидация наступает, когда LTV поднимается до лимита."
          value={ltvPercent === null ? null : tablePct(ltvPercent, 1)}
          mono={false}
          delta={
            limitPercent === null
              ? "лимит неизвестен"
              : `лимит ${tablePct(limitPercent, 1)}`
          }
        />
        <Metric
          label="Цена ликвидации"
          value={dropPercent === null ? null : tablePctSigned(dropPercent, 1)}
          mono={false}
          delta="запас по падению залога"
        />
      </MetricRow>

      <VisualHead
        className="border-line border-t"
        label="Запас прочности"
        note={`HF ${formatHf(hf)} · порог ${formatHfThreshold(hfWarningThreshold)} · ликвидация 1,00`}
      />
      <SafetyBar
        className="pt-2.5"
        liquidationPercent={LIQUIDATION_MARK}
        dangerPercent={DANGER_MARK}
        position={hfPercent(hf, hfWarningThreshold)}
        tone={tone}
        labels={
          <>
            <span>ликвидация</span>
            <span>опасно</span>
            <span style={{ color: `var(--${tone})` }}>
              {`сейчас ${formatHf(hf)}`}
            </span>
            <span>безопасно</span>
          </>
        }
      />

      <Verdict>
        {verdict ??
          (dropPercent === null
            ? "Health factor не прочитан — запас до ликвидации не считается."
            : status === "below"
              ? `Health factor ниже порога: до ликвидации залогу хватит падения на ${tablePct(Math.abs(dropPercent), 1)}.`
              : `До ликвидации залог может упасть на ${tablePct(Math.abs(dropPercent), 1)} — заём в этом запасе и работает.`)}
      </Verdict>
    </PositionShell>
  );
}

/**
 * Разметка полосы прочности (дизайн, «Запас прочности»): ликвидация 1,00
 * стоит на 22% ширины, порог предупреждения — на 42%, дальше спокойная
 * зона до HF = 2,00. Шкала кусочно-линейная нарочно: равномерная отдала бы
 * половину полосы значениям, которые уже ничего не решают.
 */
const LIQUIDATION_MARK = 22;
const DANGER_MARK = 42;
/** Дальше этого HF полоса не растёт: «безопасно» и «очень безопасно» равны. */
const SAFE_HF = 2;

export function hfPercent(
  healthFactor: number | null,
  threshold: number,
): number {
  if (healthFactor === null) return 100;
  // Порог, вплотную придвинутый к ликвидации, схлопнул бы жёлтую зону
  // в ноль и уронил бы шкалу в деление на ноль
  const warn = Math.max(threshold, 1.05);
  const safe = Math.max(warn + 0.5, SAFE_HF);
  if (healthFactor <= 0) return 0;
  if (healthFactor < 1) return healthFactor * LIQUIDATION_MARK;
  if (healthFactor < warn) {
    return (
      LIQUIDATION_MARK +
      ((healthFactor - 1) / (warn - 1)) * (DANGER_MARK - LIQUIDATION_MARK)
    );
  }
  if (healthFactor >= safe) return 100;
  return (
    DANGER_MARK + ((healthFactor - warn) / (safe - warn)) * (100 - DANGER_MARK)
  );
}
