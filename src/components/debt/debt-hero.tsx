import { DcCard } from "@/components/dc/card";
import { StatusChip } from "@/components/dc/chip";
import { SafetyBar } from "@/components/dc/bar";
import { HelpTip } from "@/components/dc/help-tip";
import { Delta, Metric, MetricGrid } from "@/components/dc/metrics";
import { dcPp, dcRate, dcUsd, tableNumber, tablePct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DEBT_UNREAD_HINT, formatHf } from "./hf";
import {
  HF_CRITICAL,
  SAFETY_DANGER_PERCENT,
  SAFETY_LIQUIDATION_PERCENT,
  hfTone,
  liquidationDrop,
  safetyPosition,
} from "./risk";

/**
 * Hero экрана «Долг» (README §6): главный вопрос страницы — насколько
 * близка ликвидация, — и ответ на него одним крупным числом.
 *
 * Три полосы каркаса дизайн-кода: HF display-числом, сетка из четырёх
 * метрик на волосяных линиях, полоса «Запас прочности» на фоне sunken.
 * Методики — под «?»; в потоке ни одного абзаца.
 */

export interface DebtHeroProps {
  healthFactor: number | null;
  threshold: number;
  /** null = долг ни разу не читался («—», не ноль). */
  debtUsd: number | null;
  /** Третий уровень ячейки «Долг»: чем занято и где. */
  debtNote: string | null;
  collateralUsd: number | null;
  collateralNote: string | null;
  ltvPercent: number | null;
  /** Порог ликвидации по LTV, восстановленный из HF. */
  liquidationLtvPercent: number | null;
  /** Стоимость заёмных стейблов, % годовых. */
  borrowRatePercent: number | null;
  /** Спред размещения к займу, п.п.: окупаются заёмные или нет. */
  spreadPp: number | null;
}

export function DebtHero({
  healthFactor,
  threshold,
  debtUsd,
  debtNote,
  collateralUsd,
  collateralNote,
  ltvPercent,
  liquidationLtvPercent,
  borrowRatePercent,
  spreadPp,
}: DebtHeroProps) {
  const tone = hfTone(healthFactor, threshold);
  const drop = liquidationDrop(healthFactor);
  const belowThreshold = healthFactor !== null && healthFactor < threshold;

  return (
    <DcCard as="section">
      <div className="flex flex-wrap items-start justify-between gap-4 px-card py-[22px]">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="t-label">Health factor</span>
            <HelpTip>
              Отношение взвешенного залога к долгу. Ликвидация наступает
              при 1,00.
            </HelpTip>
          </div>
          <p
            className={cn(
              "t-display mt-1.5",
              tone === "profit" && "text-profit",
              tone === "warn" && "text-warn",
              tone === "loss" && "text-loss",
              tone === null && "text-text-3",
            )}
          >
            {debtUsd === null || healthFactor === null
              ? "—"
              : formatHf(healthFactor)}
          </p>
          <p className="mt-1.5 text-[13px] text-text-3">
            {debtUsd === null
              ? DEBT_UNREAD_HINT
              : healthFactor === null
                ? "health factor не прочитан"
                : drop === null
                  ? "запаса не осталось — залог уже не покрывает долг"
                  : `запас до ликвидации — падение залога на ${tablePct(drop * 100, 1)}`}
          </p>
        </div>
        {belowThreshold && (
          <StatusChip tone={healthFactor < HF_CRITICAL ? "loss" : "warn"}>
            ниже порога {tableNumber(threshold, 2)}
          </StatusChip>
        )}
      </div>

      <MetricGrid className="border-line border-t">
        <Metric
          label="Долг"
          value={debtUsd === null ? null : dcUsd(debtUsd)}
          hint={debtUsd === null ? DEBT_UNREAD_HINT : undefined}
          delta={debtNote}
        />
        <Metric
          label="Залог"
          value={collateralUsd === null ? null : dcUsd(collateralUsd)}
          delta={collateralNote}
        />
        <Metric
          label="LTV"
          mono={false}
          hint="Долг, делённый на залог. Ликвидация наступает, когда отношение доходит до порога протокола."
          value={ltvPercent === null ? null : tablePct(ltvPercent, 1)}
          delta={
            liquidationLtvPercent === null
              ? "порог ликвидации неизвестен"
              : `ликвидация при ${tablePct(liquidationLtvPercent, 1)}`
          }
        />
        <Metric
          label="Стоимость долга"
          mono={false}
          hint="Средневзвешенная ставка займа в стейблах. Депозит держат, только пока его ставка выше этой."
          value={borrowRatePercent === null ? null : dcRate(borrowRatePercent)}
          delta={
            spreadPp === null ? (
              "сравнить со ставкой размещения не с чем"
            ) : spreadPp > 0 ? (
              <Delta tone="profit">окупается: {dcPp(spreadPp)}</Delta>
            ) : (
              <Delta tone="loss">дороже размещения: {dcPp(spreadPp)}</Delta>
            )
          }
        />
      </MetricGrid>

      {healthFactor !== null && (
        <div className="border-line border-t bg-sunken">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-card pt-3.5">
            <span className="t-label">Запас прочности</span>
            <span className="text-[12px] text-text-3">
              ликвидация 1,00 · порог {tableNumber(threshold, 2)} · сейчас{" "}
              {formatHf(healthFactor)}
            </span>
          </div>
          <SafetyBar
            className="pt-2.5"
            liquidationPercent={SAFETY_LIQUIDATION_PERCENT}
            dangerPercent={SAFETY_DANGER_PERCENT}
            position={safetyPosition(healthFactor, threshold)}
            tone={tone ?? "profit"}
            labels={
              <>
                <span>ликвидация</span>
                <span>опасно</span>
                <span
                  className={cn(
                    tone === "profit" && "text-profit",
                    tone === "warn" && "text-warn",
                    tone === "loss" && "text-loss",
                  )}
                >
                  сейчас {formatHf(healthFactor)}
                </span>
                <span>безопасно</span>
              </>
            }
          />
        </div>
      )}
    </DcCard>
  );
}
