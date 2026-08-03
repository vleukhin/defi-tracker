import { DcCard, SectionHead, Verdict } from "@/components/dc/card";
import { StatusChip } from "@/components/dc/chip";
import { Dash, DcTable, Td, Th, Tr } from "@/components/dc/table";
import { dcUsd, tableNumber, tablePct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { dropScenarios, dropToHf } from "./risk";

/**
 * «Если залог упадёт» (README §6): сколько рынка выдерживает позиция.
 *
 * Считается от актуальных залога, долга и HF, а не от зашитых чисел:
 * HF линеен по стоимости залога, поэтому падение на d умножает его
 * на (1 − d), а точка ликвидации — там, где произведение равно единице.
 *
 * С уровнями стратегии −7 / −15 / −30 / −50 / −70 таблица не связана:
 * те считаются от подвижной точки отсчёта по цене BTC и говорят, что
 * делать с GM-пулами (docs/07 §7). Здесь — только запас до ликвидации.
 */
export function DebtScenarios({
  healthFactor,
  collateralUsd,
  threshold,
  multiChain,
}: {
  healthFactor: number | null;
  /** Залог сети, задающей минимальный HF, — сценарий считается по ней. */
  collateralUsd: number | null;
  threshold: number;
  /** Долг больше чем в одной сети: уточняем, по какой считали. */
  multiChain: boolean;
}) {
  const rows = dropScenarios({ healthFactor, collateralUsd, threshold });
  const thresholdDrop = dropToHf(healthFactor, threshold);

  return (
    <DcCard as="section" className="flex flex-col">
      <SectionHead
        title="Если залог упадёт"
        className="border-line border-b"
        hint={
          <>
            Расчёт при неизменном долге: HF пересчитан на падение стоимости
            залога{multiChain ? " в сети с наименьшим запасом" : ""}. Уровни
            стратегии −7 / −15 / −30 считаются от точки отсчёта по цене BTC
            и с этой таблицей не связаны.
          </>
        }
      />

      {rows.length === 0 ? (
        <p className="t-meta px-card py-6 text-text-3">
          Пока долга нет, падение залога ликвидацией не грозит.
        </p>
      ) : (
        <>
          <DcTable minWidth={420}>
            <thead>
              <tr>
                <Th>Падение</Th>
                <Th numeric>Залог</Th>
                <Th numeric>HF</Th>
                <Th numeric>Статус</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.drop}>
                  <Td mono>−{tablePct(row.drop * 100, row.liquidation ? 1 : 0)}</Td>
                  <Td numeric mono>
                    {row.collateralUsd === null ? (
                      <Dash />
                    ) : (
                      dcUsd(row.collateralUsd)
                    )}
                  </Td>
                  <Td
                    numeric
                    mono
                    className={cn(
                      row.tone === "profit" && "text-profit",
                      row.tone === "warn" && "text-warn",
                      row.tone === "loss" && "text-loss",
                    )}
                  >
                    {tableNumber(row.healthFactor, 2)}
                  </Td>
                  <Td numeric>
                    <StatusChip tone={row.tone} className="ml-auto">
                      {row.status}
                    </StatusChip>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DcTable>

          <Verdict className="mt-auto">
            {thresholdDrop === null
              ? `HF уже ниже порога ${tableNumber(threshold, 2)} — ближайшая точка действия пройдена.`
              : `Порог ${tableNumber(threshold, 2)} достигается падением залога на ${tablePct(thresholdDrop * 100, 0)} — это ближайшая точка действия.`}
          </Verdict>
        </>
      )}
    </DcCard>
  );
}
