"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { DcCard, SectionHead } from "@/components/dc/card";
import { Dash, DcTable, Td, Th, TotalRow, Tr } from "@/components/dc/table";
import type { DebtChainDto } from "@/lib/api/types";
import {
  chainLabel,
  dcUsd,
  formatRelativeTime,
  tableNumber,
  tablePct,
  tableQuantity,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatHf, hfStatus, hfTitle } from "./hf";
import { hfTone } from "./risk";

/**
 * Ячейка суммы: «—» означает «не прочитано», ноль — это ноль.
 * Форму нуля («$0», не «$0,00») держит сам `dcUsd`.
 */
function usdCell(value: number | null) {
  return value === null ? <Dash /> : dcUsd(value);
}

/**
 * Долг по сетям: hero отвечает за портфель целиком, а ликвидация приходит
 * в конкретную сеть — с её собственными залогом, долгом и HF. Разбивка
 * по занятым токенам раскрывается строкой: читают её редко, а место
 * она отнимает у чисел, ради которых на экран заходят.
 */
export function DebtChains({
  chains,
  threshold,
  totalCollateralUsd,
  totalDebtUsd,
  minHealthFactor,
}: {
  chains: DebtChainDto[];
  threshold: number;
  totalCollateralUsd: number | null;
  totalDebtUsd: number | null;
  minHealthFactor: number | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const totalUtilization =
    totalDebtUsd !== null && totalCollateralUsd !== null && totalCollateralUsd > 0
      ? (totalDebtUsd / totalCollateralUsd) * 100
      : null;

  return (
    <DcCard as="section">
      <SectionHead
        title="Долг по сетям"
        count={chains.length}
        className="border-line border-b"
        hint="Health factor сети — минимальный среди её кошельков: ликвидация приходит к худшему из них."
      />
      <DcTable minWidth={640}>
        <thead>
          <tr>
            <Th>Сеть</Th>
            <Th numeric>Залог</Th>
            <Th numeric>Долг</Th>
            <Th numeric>HF</Th>
            <Th numeric>Утилизация</Th>
          </tr>
        </thead>
        <tbody>
          {chains.map((chain) => {
            const expanded = open === chain.chain;
            const tone = hfTone(chain.healthFactor, threshold);
            const status = hfStatus(chain.healthFactor, threshold);
            return (
              <Fragment key={chain.chain}>
                <Tr>
                  <Td>
                    {chain.items.length > 0 ? (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() =>
                          setOpen(expanded ? null : chain.chain)
                        }
                        className="-ml-1 flex items-center gap-1.5 rounded-control px-1 py-0.5 text-left outline-none transition-colors duration-120 ease-out pointer-coarse:min-h-11 hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <ChevronRight
                          aria-hidden
                          className={cn(
                            "size-3.5 shrink-0 text-text-3 transition-transform duration-150",
                            expanded && "rotate-90",
                          )}
                        />
                        {chainLabel(chain.chain)}
                        <span className="text-text-3">
                          · {formatRelativeTime(chain.checkedAt) ?? "—"}
                        </span>
                      </button>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        {chainLabel(chain.chain)}
                        <span className="text-text-3">
                          · {formatRelativeTime(chain.checkedAt) ?? "—"}
                        </span>
                      </span>
                    )}
                  </Td>
                  <Td numeric mono>{usdCell(chain.totalCollateralUsd)}</Td>
                  <Td numeric mono>{usdCell(chain.totalDebtUsd)}</Td>
                  <Td
                    numeric
                    mono
                    title={hfTitle(status, threshold)}
                    className={cn(
                      tone === "profit" && "text-profit",
                      tone === "warn" && "text-warn",
                      tone === "loss" && "text-loss",
                    )}
                  >
                    {formatHf(chain.healthFactor)}
                  </Td>
                  <Td numeric>
                    {chain.utilization === null ? (
                      <Dash />
                    ) : (
                      tablePct(chain.utilization * 100, 1)
                    )}
                  </Td>
                </Tr>

                {expanded &&
                  chain.items.map((item) => (
                    <Tr
                      key={`${chain.chain}-${item.symbol}-${item.quantity}`}
                      className="bg-sunken"
                    >
                      <Td
                        muted
                        className="first:pl-[calc(var(--spacing-card)+22px)]"
                      >
                        {item.symbol}
                      </Td>
                      <Td numeric muted>
                        <Dash />
                      </Td>
                      <Td numeric mono>{usdCell(item.valueUsd)}</Td>
                      <Td numeric mono muted colSpan={2}>
                        {tableQuantity(item.quantity)}
                      </Td>
                    </Tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
        {chains.length > 1 && (
          <tfoot>
            <TotalRow>
              <Td>Итого</Td>
              <Td numeric mono>{usdCell(totalCollateralUsd)}</Td>
              <Td numeric mono>{usdCell(totalDebtUsd)}</Td>
              <Td numeric mono>
                {minHealthFactor === null ? (
                  <Dash />
                ) : (
                  tableNumber(minHealthFactor, 2)
                )}
              </Td>
              <Td numeric>
                {totalUtilization === null ? (
                  <Dash />
                ) : (
                  tablePct(totalUtilization, 1)
                )}
              </Td>
            </TotalRow>
          </tfoot>
        )}
      </DcTable>
    </DcCard>
  );
}
