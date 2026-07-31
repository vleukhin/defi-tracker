"use client";

import { pnlClass } from "@/components/pnl";
import { DEBT_UNREAD_HINT } from "@/components/debt/hf";
import { HfBadge } from "@/components/debt/hf-badge";
import type { DebtSummaryDto, PortfolioOverviewDto } from "@/lib/api/types";
import { tableUsd, tableUsdSigned, usdDecimals } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Связка пяти чисел в шапке дашборда (Фаза 4, S4.2):
 * Активы · Долг · Чистая · Внесено · Прибыль — именно связкой, порознь
 * числа не отвечают на вопрос «сколько я заработал».
 *
 * Активы — главное число экрана (display-стиль, как раньше итог);
 * остальные четыре — компактной группой рядом + постоянный HF-бейдж (S4.3).
 * null (долг ни разу не прочитан) рисуется «—» с подсказкой — не нулем.
 * На 375px группа сворачивается в сетку 2×2 без горизонтального скролла.
 *
 * Фаза 5: Активы = портфель + размещенные позиции, поэтому под главным числом
 * идет расшифровка. Итог таблицы портфеля ниже по странице — это по-прежнему
 * ТОЛЬКО портфель (три категории ведутся по собственным средствам), и без
 * расшифровки два числа выглядели бы противоречащими друг другу.
 */

const ASSETS_UNKNOWN_HINT =
  "Стоимость части размещенных позиций неизвестна — сумма не выводится";

export function OverviewStrip({
  overview,
  debtSummary,
}: {
  overview: PortfolioOverviewDto;
  debtSummary: DebtSummaryDto | null;
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
      <div>
        <p className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
          Активы
        </p>
        <p
          className={cn(
            "mt-1 font-mono text-3xl leading-none font-semibold tracking-tight sm:text-4xl",
            overview.assetsUsd === null && "text-muted-foreground",
          )}
          title={overview.assetsUsd === null ? ASSETS_UNKNOWN_HINT : undefined}
        >
          {overview.assetsUsd === null ? "—" : tableUsd(overview.assetsUsd)}
        </p>
        {/* Расшифровка появляется только когда есть что расшифровывать:
            без позиций Активы равны портфелю, и строка была бы шумом */}
        {overview.positionsUsd !== null && overview.positionsUsd !== 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            портфель{" "}
            <span className="font-mono">{tableUsd(overview.portfolioUsd)}</span>
            {" · размещено "}
            <span className="font-mono">{tableUsd(overview.positionsUsd)}</span>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:items-end">
          <StripItem
            label="Долг"
            value={overview.debtUsd === null ? null : tableUsd(overview.debtUsd)}
          />
          <StripItem
            label="Чистая"
            value={overview.netUsd === null ? null : tableUsd(overview.netUsd)}
          />
          <StripItem
            label="Внесено"
            value={tableUsd(overview.depositedUsd)}
          />
          <StripItem
            label="Прибыль"
            value={
              overview.profitUsd === null
                ? null
                : tableUsdSigned(
                    overview.profitUsd,
                    usdDecimals(overview.profitUsd),
                  )
            }
            className={
              overview.profitUsd === null
                ? undefined
                : pnlClass(overview.profitUsd)
            }
          />
        </dl>
        <HfBadge summary={debtSummary} />
      </div>
    </div>
  );
}

/**
 * Одно число связки: подпись 11px uppercase (как в карточках-метриках),
 * значение mono. value === null — «долг еще не читался», честное «—».
 */
function StripItem({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null;
  className?: string;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 font-mono text-sm leading-none font-semibold whitespace-nowrap",
          value === null && "text-muted-foreground",
          className,
        )}
        title={value === null ? DEBT_UNREAD_HINT : undefined}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}
