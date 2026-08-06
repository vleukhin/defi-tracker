"use client";

import type { ReactNode } from "react";
import { SafetyBar } from "@/components/dc/bar";
import { Verdict } from "@/components/dc/card";
import { Chip, StatusChip } from "@/components/dc/chip";
import { Metric } from "@/components/dc/metrics";
import { formatHf, formatHfThreshold } from "@/components/debt/hf";
import {
  SAFETY_DANGER_PERCENT,
  SAFETY_LIQUIDATION_PERCENT,
  hfTone,
  safetyPosition,
} from "@/components/debt/risk";
import { hfZone, isDangerZone } from "@/lib/hf-zones";
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

  // Цвет и полоса берутся из общих функций «Долга»: раньше карточка красила
  // по hfStatus и рисовала маркер по собственной шкале, и один и тот же HF
  // выглядел здесь иначе, чем на экране «Долг»
  const tone = hfTone(hf, hfWarningThreshold) ?? "profit";
  const belowThreshold = isDangerZone(hfZone(hf, hfWarningThreshold));

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
        liquidationPercent={SAFETY_LIQUIDATION_PERCENT}
        dangerPercent={SAFETY_DANGER_PERCENT}
        // Долга нет — запас не ограничен, маркер в самом конце полосы
        position={hf === null ? 100 : safetyPosition(hf, hfWarningThreshold)}
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
            : belowThreshold
              ? `Health factor ниже порога: до ликвидации залогу хватит падения на ${tablePct(Math.abs(dropPercent), 1)}.`
              : `До ликвидации залог может упасть на ${tablePct(Math.abs(dropPercent), 1)} — заём в этом запасе и работает.`)}
      </Verdict>
    </PositionShell>
  );
}

/*
 * Собственной шкалы полосы у карточки больше нет.
 *
 * Здесь жила hfPercent — кусочно-линейная разметка с третьим участком до
 * HF = 2. Ниже порога она совпадала с safetyPosition из «Долга» (обе
 * привязаны к 22% и 42%), а выше расходилась: при HF 1,68 и пороге 1,50
 * маркер стоял на 63% против 49%, и запас прочности «вырастал» на четверть
 * полосы при переходе с «Долга» в «Зоны». Осталась одна функция —
 * safetyPosition, та, что документирует своё свойство: полоса не может
 * противоречить числу.
 */
