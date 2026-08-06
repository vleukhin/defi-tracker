"use client";

import { DcCard } from "@/components/dc/card";
import type {
  DebtSummaryDto,
  PortfolioDto,
  ZonesSummaryDto,
} from "@/lib/api/types";
import { CategoryAllocation, ZoneAllocation } from "./allocation-bar";
import {
  type AssetsDelta,
  type CoinAmount,
  OverviewStrip,
} from "./overview-strip";
import type { PortfolioView } from "./portfolio-tabs";

/**
 * Первый блок экрана отвечает на его главный вопрос одним крупным числом
 * (чек-лист §8): сколько всего капитала и как он распределён.
 *
 * Карточка одна на оба разреза. Верхняя зона не меняется — «Активы» это
 * «Активы» в любой проекции; переключатель подменяет только нижнюю зону
 * на фоне --bg-sunken. Так видно, что это один портфель, а не два экрана.
 */
export function PortfolioHero({
  view,
  portfolio,
  zones,
  debtSummary,
  delta,
  coins,
}: {
  view: PortfolioView;
  portfolio: PortfolioDto;
  /** null = разрез по зонам ещё не загружен либо не прочитался. */
  zones: ZonesSummaryDto | null;
  debtSummary: DebtSummaryDto | null;
  delta: AssetsDelta | null;
  /** Количества BTC и ETH: главная метрика стратегии (docs/07 §4). */
  coins: CoinAmount[];
}) {
  return (
    <DcCard>
      <OverviewStrip
        overview={portfolio.overview}
        debtSummary={debtSummary}
        delta={delta}
        coins={coins}
      />
      {/* В режиме сигналов внизу стоит разрез по зонам: лента говорит на
          языке стратегии, и категории под ней были бы про другое */}
      {view === "categories" ? (
        <CategoryAllocation
          rows={portfolio.rows}
          portfolioUsd={portfolio.overview.portfolioUsd}
          positionsUsd={portfolio.overview.positionsUsd}
        />
      ) : (
        zones && <ZoneAllocation zones={zones} />
      )}
    </DcCard>
  );
}
