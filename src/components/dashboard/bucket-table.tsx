"use client";

import { useState } from "react";
import type { BucketAllocationDto } from "@/lib/api/types";
import {
  DEVIATION_THRESHOLD_PP,
  NBSP,
  formatPct,
  formatPp,
  formatUsd,
} from "@/lib/format";
import { AssetList } from "./asset-list";

/**
 * Таблица корзин (S1.7): стоимость, текущий %, целевой %, отклонение в п.п.,
 * сумма ребалансировки. На десктопе — грид-строки под шапкой, на мобильных
 * та же разметка складывается в карточку (подписи ячеек видны только там) —
 * без горизонтального скролла на 375px. Строки раскрываются: активы -> источники.
 * |отклонение| > 5 п.п. выделено, стрелка дублирует цвет.
 */

const GRID =
  "sm:grid sm:grid-cols-[minmax(0,1fr)_7.5rem_4.5rem_4.5rem_6.5rem_7.5rem] sm:items-center sm:gap-x-3";

function CellLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-xs text-gray-500 sm:hidden">{children}</span>
  );
}

function DeviationCell({ deviationPp }: { deviationPp: number | null }) {
  if (deviationPp === null) {
    return <span className="text-sm text-gray-400">—</span>;
  }
  const over = deviationPp > DEVIATION_THRESHOLD_PP;
  const under = deviationPp < -DEVIATION_THRESHOLD_PP;
  const cls = over
    ? "bg-orange-50 text-orange-800"
    : under
      ? "bg-sky-50 text-sky-800"
      : "text-gray-700";
  const arrow = over ? `▲${NBSP}` : under ? `▼${NBSP}` : "";
  return (
    <span
      className={`inline-block rounded px-1 text-sm tabular-nums whitespace-nowrap ${cls}`}
    >
      {arrow}
      {formatPp(deviationPp)}
    </span>
  );
}

function RebalanceCell({ rebalanceUsd }: { rebalanceUsd: number | null }) {
  if (rebalanceUsd === null) {
    return <span className="text-sm text-gray-400">—</span>;
  }
  if (Math.abs(rebalanceUsd) < 1) {
    return <span className="text-sm text-gray-500">в балансе</span>;
  }
  const verb = rebalanceUsd > 0 ? "Купить" : "Продать";
  return (
    <span className="text-sm tabular-nums whitespace-nowrap text-gray-900">
      {verb} {formatUsd(Math.abs(rebalanceUsd), 0)}
    </span>
  );
}

function BucketRow({ bucket }: { bucket: BucketAllocationDto }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-t border-gray-100 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`grid w-full grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-left hover:bg-gray-50 ${GRID}`}
      >
        <span className="col-span-2 flex items-center gap-2 sm:col-span-1">
          <span
            aria-hidden="true"
            className={`text-[10px] text-gray-400 transition-transform ${
              open ? "rotate-90" : ""
            }`}
          >
            ▶
          </span>
          <span className="truncate text-sm font-medium text-gray-900">
            {bucket.name}
          </span>
        </span>

        <span className="sm:text-right">
          <CellLabel>Стоимость</CellLabel>
          <span className="text-sm tabular-nums font-medium text-gray-900">
            {formatUsd(bucket.valueUsd)}
          </span>
        </span>

        <span className="sm:text-right">
          <CellLabel>Текущий %</CellLabel>
          <span className="text-sm tabular-nums text-gray-900">
            {formatPct(bucket.currentPct)}
          </span>
        </span>

        <span className="sm:text-right">
          <CellLabel>Цель %</CellLabel>
          <span className="text-sm tabular-nums text-gray-700">
            {bucket.targetPct === null ? "—" : formatPct(bucket.targetPct)}
          </span>
        </span>

        <span className="sm:text-right">
          <CellLabel>Отклонение</CellLabel>
          <DeviationCell deviationPp={bucket.deviationPp} />
        </span>

        <span className="sm:text-right">
          <CellLabel>Ребалансировка</CellLabel>
          <RebalanceCell rebalanceUsd={bucket.rebalanceUsd} />
        </span>
      </button>

      {open &&
        (bucket.assets.length > 0 ? (
          <div className="border-t border-gray-100 bg-white pl-2">
            <AssetList assets={bucket.assets} />
          </div>
        ) : (
          <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
            В корзине нет активов — задана только цель.
          </p>
        ))}
    </li>
  );
}

export function BucketTable({ buckets }: { buckets: BucketAllocationDto[] }) {
  if (buckets.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* Шапка — только десктоп; на мобильных подписи внутри карточек */}
      <div
        aria-hidden="true"
        className={`hidden px-4 py-2 text-xs font-medium text-gray-500 ${GRID}`}
      >
        <span>Корзина</span>
        <span className="text-right">Стоимость</span>
        <span className="text-right">Текущий&nbsp;%</span>
        <span className="text-right">Цель&nbsp;%</span>
        <span className="text-right">Отклонение</span>
        <span className="text-right">Ребалансировка</span>
      </div>
      <ul>
        {buckets.map((b) => (
          <BucketRow key={b.bucketId} bucket={b} />
        ))}
      </ul>
    </div>
  );
}
