import { DcCard, SectionHead, Verdict } from "@/components/dc/card";
import { StatusChip } from "@/components/dc/chip";
import { Dash, DcTable, Td, Th, Tr } from "@/components/dc/table";
import type { CollateralCategory } from "@/lib/api/types";
import { dcUsd, tableNumber, tablePct } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  type BasePriceColumn,
  basePriceColumns,
  dropScenarios,
  dropToHf,
  priceAtDrop,
} from "./risk";

/**
 * «Если залог упадёт» (README §6): сколько рынка выдерживает позиция.
 *
 * Считается от актуальных залога, долга и HF, а не от зашитых чисел:
 * HF линеен по стоимости залога, поэтому падение на d умножает его
 * на (1 − d), а точка ликвидации — там, где произведение равно единице.
 *
 * Ступени подписаны ценами BTC и ETH: «−30%» — это процент, а решение
 * принимается по цене, и держать пересчёт в голове (или в другой вкладке)
 * пользователь не должен. Цены — прямое «текущая × (1 − d)», то есть
 * допущение о синхронном движении базовых активов; оно проговорено
 * в подсказке карточки, а сама арифметика живёт в risk.ts.
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
  collateralCategories,
  basePricesUsd,
}: {
  healthFactor: number | null;
  /** Залог сети, задающей минимальный HF, — сценарий считается по ней. */
  collateralUsd: number | null;
  threshold: number;
  /** Долг больше чем в одной сети: уточняем, по какой считали. */
  multiChain: boolean;
  /** Чем обеспечен залог этой сети; пусто = ещё не читался. */
  collateralCategories: CollateralCategory[];
  basePricesUsd: Record<CollateralCategory, number | null>;
}) {
  const rows = dropScenarios({ healthFactor, collateralUsd, threshold });
  const thresholdDrop = dropToHf(healthFactor, threshold);
  const priceColumns = basePriceColumns(collateralCategories, basePricesUsd);

  return (
    <DcCard as="section" className="flex flex-col">
      <SectionHead
        title="Если залог упадёт"
        className="border-line border-b"
        hint={
          <>
            Расчёт при неизменном долге: HF пересчитан на падение стоимости
            залога{multiChain ? " в сети с наименьшим запасом" : ""}.
            {priceColumns.length > 0 && (
              <>
                {" "}
                Цены — то же падение, применённое к текущим: залог потеряет
                столько, только если базовые активы пойдут вниз вместе.
              </>
            )}{" "}
            Уровни стратегии −7 / −15 / −30 считаются от точки отсчёта по цене
            BTC и с этой таблицей не связаны.
          </>
        }
      />

      {rows.length === 0 ? (
        <p className="t-meta px-card py-6 text-text-3">
          Пока долга нет, падение залога ликвидацией не грозит.
        </p>
      ) : (
        <>
          {/* Каждая колонка цены — ещё ~104px: без этого на телефоне
              таблица сжимала бы числа вместо горизонтальной прокрутки */}
          <DcTable minWidth={420 + priceColumns.length * 104}>
            <thead>
              <tr>
                <Th>Падение</Th>
                {priceColumns.map((column) => (
                  <Th key={column.category} numeric>
                    Цена {column.label}
                  </Th>
                ))}
                <Th numeric>Залог</Th>
                <Th numeric>HF</Th>
                <Th numeric>Статус</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.drop}>
                  <Td mono>−{tablePct(row.drop * 100, row.liquidation ? 1 : 0)}</Td>
                  {priceColumns.map((column) => (
                    <Td key={column.category} numeric mono>
                      {dcUsd(priceAtDrop(column.priceUsd, row.drop))}
                    </Td>
                  ))}
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
              : // Порогового падения нет среди строк таблицы, поэтому цены
                // к нему дописываются здесь: точка действия должна читаться
                // ценой так же, как ступени
                `Порог ${tableNumber(threshold, 2)} достигается падением залога на ${tablePct(thresholdDrop * 100, 0)}${pricesAt(priceColumns, thresholdDrop)} — это ближайшая точка действия.`}
          </Verdict>
        </>
      )}
    </DcCard>
  );
}

/** « (BTC $95 000 · ETH $3 240)» — пусто, если цен нет. */
function pricesAt(columns: BasePriceColumn[], drop: number): string {
  if (columns.length === 0) return "";
  const parts = columns.map(
    (c) => `${c.label} ${dcUsd(priceAtDrop(c.priceUsd, drop))}`,
  );
  return ` (${parts.join(" · ")})`;
}
