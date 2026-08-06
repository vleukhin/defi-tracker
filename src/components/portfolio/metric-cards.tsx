"use client";

import { HelpTip } from "@/components/dc/help-tip";
import type { PortfolioRowDto } from "@/lib/api/types";
import {
  DEVIATION_THRESHOLD_PP,
  dcPp,
  dcUsd,
  dcUsdSigned,
  tableNumber,
  tablePct,
  tablePctSigned,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { AccentCard } from "./accent-card";
import { CATEGORY_VAR, CategoryDot } from "./category";

/**
 * Карточки категорий: «в чём лежит капитал» и насколько это расходится
 * с целевой долей.
 *
 * Цвет актива — только кромка сверху 2px и точка (§2: заливать карточку
 * цветом данных нельзя). Единственное крупное число в карточке — сумма;
 * доля, цель и P/L набраны мелко и спорить с ней не могут.
 */

/**
 * «?» только у стейблов: у BTC и ETH сумма — это залог по текущей цене,
 * и вопросов не вызывает. Стейблы же складываются из собственных долей
 * позиций, и их сумма не совпадает с тем, сколько денег в позиции внесли —
 * это и сбивает с толку.
 */
/*
 * Единица отклонения объяснена словами: величина — процентные пункты,
 * но пишется процентом (решение владельца, см. dcPp). Без пояснения
 * «+3,13%» рядом с долей «53,13%» читается как «на 3,13% больше».
 */
const DEVIATION_HINT =
  "Насколько доля отличается от цели, в процентных пунктах: «+3,13%» значит «на 3,13 пункта выше цели», а не «на 3,13% больше».";
const PNL_HINT =
  "Нереализованная прибыль: текущая стоимость минус средняя цена покупки по журналу сделок. Продажи сюда не входят.";
const STABLE_HINT =
  "Залог в стейблах, ручные записи, собственные доли позиций и свободные стейблы на кошельках — всё по текущей стоимости, а не по вложенному. Просадка и доход позиции делятся между своими и заёмными пропорционально вложенному, поэтому своя доля движется вместе с позицией. Заёмные свободные средства сюда не входят: они в «Активах» и в зоне Yield.";
export function MetricCards({ rows }: { rows: PortfolioRowDto[] }) {
  return (
    <section className="grid gap-3 md:grid-cols-3">
      {rows.map((row) => (
        <CategoryCard key={row.category} row={row} />
      ))}
    </section>
  );
}

function CategoryCard({ row }: { row: PortfolioRowDto }) {
  const beyond =
    row.percentDiff !== null &&
    Math.abs(row.percentDiff) > DEVIATION_THRESHOLD_PP;
  const pnl = row.ledger.unrealizedPnlUsd;

  return (
    <AccentCard color={CATEGORY_VAR[row.category]}>
      <div className="flex items-center gap-2">
        <CategoryDot category={row.category} size={7} />
        <h3 className="text-[14px] font-semibold tracking-[-0.01em]">
          {row.label}
        </h3>
        {row.category === "stable" && <HelpTip>{STABLE_HINT}</HelpTip>}
        <span className="ml-auto text-[13px] font-medium text-text-2">
          {tablePct(row.percent)}
        </span>
      </div>

      {/* Иерархия следует стратегии (docs/07 §4): главная метрика — сколько
          монет, а не сколько долларов, «на цену повлиять нельзя, на
          количество можно». Поэтому крупным набрано количество, а
          долларовая стоимость — строкой ниже. Раньше было наоборот: 27px
          на доллары против 13px приглушённым на количество.

          У стейблов количество и есть доллары, поэтому там крупной остаётся
          сумма, а вторая строка держит высоту неразрывным пробелом: три
          карточки стоят в одном ряду, и «цель» с «P/L» обязаны читаться
          по общей линии. */}
      {row.unit === "USD" ? (
        <>
          <p className="mt-3.5 t-metric-lg">{dcUsd(row.amountUsd)}</p>
          {/* Неразрывный пробел, а не обычный: обычный схлопнулся бы,
              и строка получила бы нулевую высоту — отступа бы не было. */}
          <p className="mt-1.5 font-mono text-[13px] text-text-2" aria-hidden>
            {"\u00A0"}
          </p>
        </>
      ) : (
        <>
          <p className="mt-3.5 t-metric-lg">
            {row.amount === null ? "—" : tableNumber(row.amount, 4)}
            <span className="ml-1.5 font-sans text-[13px] text-text-3">
              {row.unit}
            </span>
          </p>
          <p className="mt-1.5 font-mono text-[13px] text-text-2">
            {dcUsd(row.amountUsd)}
          </p>
        </>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-[7px] text-[12.5px] text-text-3">
        <span>
          {row.targetPercent === null
            ? "цель не задана"
            : `цель ${tablePct(row.targetPercent)}`}
        </span>
        {row.percentDiff !== null && (
          <>
            <span aria-hidden className="text-text-4">
              ·
            </span>
            <span className={cn(beyond && "text-warn")}>
              {dcPp(row.percentDiff)}
            </span>
            <HelpTip>{DEVIATION_HINT}</HelpTip>
          </>
        )}
      </p>

      <p className="mt-2 flex flex-wrap items-center gap-x-[7px] text-[12.5px]">
        <span className="text-text-3">P/L</span>
        <HelpTip>{PNL_HINT}</HelpTip>
        {pnl === null ? (
          <span className="text-text-3">—</span>
        ) : (
          <span
            className={cn(
              "font-medium whitespace-nowrap",
              pnl > 0 && "text-profit",
              pnl < 0 && "text-loss",
              pnl === 0 && "text-text-2",
            )}
          >
            {dcUsdSigned(pnl)}
            {row.ledger.unrealizedPnlPct !== null && (
              <>
                {" · "}
                {tablePctSigned(row.ledger.unrealizedPnlPct, 1)}
              </>
            )}
          </span>
        )}
      </p>
    </AccentCard>
  );
}
