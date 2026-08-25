"use client";

import Link from "next/link";
import { Disclaimer } from "@/components/dc/card";
import { Button } from "@/components/ui/button";
import type {
  DepositDto,
  PortfolioDto,
  SnapshotsResponseDto,
} from "@/lib/api/types";
import { tablePct } from "@/lib/format";
import { MetricCards } from "./metric-cards";
import { PortfolioTable } from "./portfolio-table";
import { ProfitSparkline } from "./profit-sparkline";

/**
 * Разрез портфеля по категориям активов — тело режима «Активы».
 *
 * Порядок отвечает на вопросы по убыванию важности: сколько в каждой
 * категории и насколько это мимо цели (карточки) → сколько из этого
 * заработано (график Прибыли) → откуда взялись числа (таблица
 * с раскрытием состава).
 *
 * Hero-карточку и шапку рисует общий каркас экрана: они одни на оба
 * разреза, и дублировать их здесь значило бы иметь два разных портфеля.
 */
export function PortfolioDashboard({
  data,
  snapshots,
  snapshotsLoading,
  snapshotsError,
  deposits,
  depositsError,
}: {
  data: PortfolioDto;
  snapshots: SnapshotsResponseDto | null;
  snapshotsLoading: boolean;
  snapshotsError: string | null;
  /** Журнал «Внесено» — без него Прибыль по истории не считается. */
  deposits: DepositDto[] | null;
  depositsError: string | null;
}) {
  const targetsSet = data.targetSumPct !== 0;
  const targetsBroken = targetsSet && Math.abs(data.targetSumPct - 100) > 0.001;

  return (
    <>
      <MetricCards rows={data.rows} />

      {!targetsSet && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-block border border-line bg-sunken px-card py-3">
          <p className="t-meta text-text-2">
            Целевые доли не заданы — отклонения и количества к ребалансировке
            не считаются.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/targets">Задать цели</Link>
          </Button>
        </div>
      )}

      {targetsBroken && (
        <p className="t-meta text-warn">
          Сумма целей {tablePct(data.targetSumPct)} — отклонения считаются
          от заданных целей, а не от ста процентов.
        </p>
      )}

      {/* Динамики стоимости здесь нет намеренно: «сколько стоит» уже
          отвечено числами в шапке экрана, а на вопрос «сколько из этого
          заработано» до сих пор не отвечал никто. Кривая стоимости
          осталась в «Истории» */}
      <ProfitSparkline
        data={snapshots}
        loading={snapshotsLoading}
        error={snapshotsError}
        deposits={deposits}
        depositsError={depositsError}
      />

      <PortfolioTable rows={data.rows} totalUsd={data.totalUsd} />

      <Disclaimer>
        Стоимость по активам учитывает залог в лендинге и ручные записи.
      </Disclaimer>
    </>
  );
}
