"use client";

import { Chip } from "@/components/dc/chip";
import { Dash, DcTable, Td, Th, Tr } from "@/components/dc/table";
import { CategoryDot } from "@/components/portfolio/category";
import type { TradeDto } from "@/lib/api/types";
import { dcUsd, tableDate, tableQuantity } from "@/lib/format";
import { CATEGORY_LABEL, CATEGORY_UNIT } from "./categories";

/**
 * Таблица сделок (README, п.4): ДАТА · АКТИВ · СТОРОНА · КОЛИЧЕСТВО · ЦЕНА ·
 * СУММА · ЗАМЕТКА · правка.
 *
 * Сторона — НЕЙТРАЛЬНЫЙ чип со стрелкой. Покупка и продажа не прибыль и не
 * убыток, семантические зелёный и красный им не принадлежат (дизайн-код §2);
 * направление несёт стрелка, а не цвет.
 *
 * На узких ширинах таблица не рассыпается в карточки, а скроллится по
 * горизонтали: сравнение строк между собой — то, ради чего она здесь.
 */

/** Числовое значение из десятичной строки; мусор → null. */
function num(raw: string): number | null {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

const SIDE: Record<TradeDto["side"], { arrow: string; label: string }> = {
  buy: { arrow: "↓", label: "покупка" },
  sell: { arrow: "↑", label: "продажа" },
};

function SideChip({ side }: { side: TradeDto["side"] }) {
  const { arrow, label } = SIDE[side];
  return (
    <Chip>
      <span aria-hidden className="text-text-3">
        {arrow}
      </span>
      {label}
    </Chip>
  );
}

export function TradesList({
  trades,
  onEdit,
}: {
  trades: TradeDto[];
  onEdit: (trade: TradeDto) => void;
}) {
  return (
    <DcTable minWidth={860}>
      <thead>
        <tr>
          <Th>Дата</Th>
          <Th>Актив</Th>
          <Th>Сторона</Th>
          <Th numeric>Количество</Th>
          <Th numeric>Цена</Th>
          <Th numeric>Сумма</Th>
          <Th className="w-full">Заметка</Th>
          <Th numeric>
            <span className="sr-only">Действия</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {trades.map((trade) => {
          const quantity = num(trade.quantity);
          const price = num(trade.priceUsd);
          // Сделка без цены (внесена нулём) — количество учтено, но денег
          // за ней нет: и цена, и сумма показываются прочерком, а не «$0»
          const hasPrice = price !== null && price > 0;
          const total = hasPrice && quantity !== null ? quantity * price : null;

          return (
            <Tr key={trade.id}>
              <Td mono muted>
                {tableDate(trade.tradedAt)}
              </Td>
              <Td>
                <span className="flex items-center gap-[7px]">
                  <CategoryDot category={trade.category} size={6} />
                  {CATEGORY_LABEL[trade.category]}
                </span>
              </Td>
              <Td>
                <SideChip side={trade.side} />
              </Td>
              <Td numeric mono>
                {tableQuantity(trade.quantity)}
                <span className="ml-1 font-sans text-[11.5px] text-text-3">
                  {CATEGORY_UNIT[trade.category]}
                </span>
              </Td>
              <Td numeric mono>
                {hasPrice ? dcUsd(price) : <Dash />}
              </Td>
              <Td numeric mono>
                {total === null ? <Dash /> : dcUsd(total)}
              </Td>
              <Td
                className="w-full max-w-0 overflow-hidden text-ellipsis text-text-2"
                title={trade.note ?? undefined}
              >
                {trade.note ? trade.note : <Dash />}
              </Td>
              <Td numeric>
                <button
                  type="button"
                  onClick={() => onEdit(trade)}
                  aria-label={`Изменить сделку от ${tableDate(trade.tradedAt)}`}
                  // Отрицательные поля возвращают hit-зону к высоте строки,
                  // не растягивая саму ячейку
                  className="-my-2.5 -mr-2 rounded-pill py-2.5 pr-2 pl-3 text-[12.5px] text-text-4 outline-none transition-colors duration-120 ease-out hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  правка
                </button>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </DcTable>
  );
}
