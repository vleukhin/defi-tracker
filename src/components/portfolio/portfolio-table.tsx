"use client";

import { useState } from "react";
import type { PortfolioRowDto } from "@/lib/api/types";
import {
  DEVIATION_THRESHOLD_PP,
  NBSP,
  chainLabel,
  formatAmount,
  formatPct,
  formatPp,
  formatQuantity,
  formatQuantityFull,
  formatSignedAmount,
  formatUsd,
} from "@/lib/format";

/**
 * Компактная таблица портфеля (S1.7): три фиксированные строки.
 * Столбцы повторяют рабочую таблицу пользователя:
 * Количество · Стоимость USD · Цена · Доля · Цель · Отклонение · К ребалансировке.
 *
 * На ≥ md — сетка со «шапкой»; на мобильном — стек карточек с подписями,
 * без горизонтальной прокрутки страницы. Строка раскрывается в состав.
 */

/** Знаков после точки в количестве категории: у стейблов дроби не нужны. */
function amountDecimals(unit: string): number {
  return unit === "USD" ? 0 : 4;
}

/**
 * Точность количества к ребалансировке подстраивается под масштаб:
 * −0.071486 BTC нужно видеть целиком, а у −3 732.86 ETH шесть знаков
 * только ломают верстку и ничего не добавляют.
 */
function balanceDecimals(unit: string, value: number): number {
  if (unit === "USD") return 0;
  const abs = Math.abs(value);
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  return 6;
}

function deviationTone(diff: number): string {
  if (diff > DEVIATION_THRESHOLD_PP) return "text-orange-700 bg-orange-50";
  if (diff < -DEVIATION_THRESHOLD_PP) return "text-sky-700 bg-sky-50";
  return "text-gray-600";
}

const GRID = "grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-8 md:gap-y-0";

export function PortfolioTable({
  rows,
  totalUsd,
}: {
  rows: PortfolioRowDto[];
  totalUsd: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* Шапка — только на десктопе; на мобильном подписи внутри карточек */}
      <div
        className={`${GRID} hidden border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500 md:grid`}
      >
        <div>Актив</div>
        <div className="text-right">Количество</div>
        <div className="text-right">Стоимость</div>
        <div className="text-right">Цена</div>
        <div className="text-right">Доля</div>
        <div className="text-right">Цель</div>
        <div className="text-right">Отклонение</div>
        <div className="text-right">К ребалансировке</div>
      </div>

      <ul className="divide-y divide-gray-100">
        {rows.map((row) => (
          <PortfolioRow key={row.category} row={row} />
        ))}
      </ul>

      <div className="flex items-baseline justify-between border-t border-gray-200 bg-gray-50 px-4 py-2.5">
        <span className="text-sm text-gray-500">Итого</span>
        <span className="text-base font-semibold text-gray-900">
          {formatUsd(totalUsd, 0)}
        </span>
      </div>
    </div>
  );
}

function PortfolioRow({ row }: { row: PortfolioRowDto }) {
  const [open, setOpen] = useState(false);
  const decimals = amountDecimals(row.unit);
  const hasDetail =
    row.collateralDetail.length > 0 || row.manualEntries.length > 0;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`${GRID} w-full items-baseline px-4 py-3 text-left hover:bg-gray-50`}
      >
        <div className="col-span-2 flex items-center gap-1.5 md:col-span-1">
          <span className="text-xs text-gray-400">{open ? "▾" : "▸"}</span>
          <span className="text-sm font-medium text-gray-900">{row.label}</span>
        </div>

        <Cell label="Количество">
          {row.amount === null ? (
            <span className="text-gray-400">нет цены</span>
          ) : (
            <>
              {formatAmount(row.amount, decimals)}
              <span className="ml-1 text-xs text-gray-400">{row.unit}</span>
            </>
          )}
        </Cell>

        <Cell label="Стоимость" strong>
          {formatUsd(row.amountUsd, 0)}
        </Cell>

        <Cell label="Цена">
          {row.price === null ? "—" : formatUsd(row.price, 0)}
          {row.priceStale && (
            <span className="ml-1 text-xs text-amber-600">устарела</span>
          )}
        </Cell>

        <Cell label="Доля">{formatPct(row.percent, 2)}</Cell>

        <Cell label="Цель">
          {row.targetPercent === null ? (
            <span className="text-gray-400">—</span>
          ) : (
            formatPct(row.targetPercent, 2)
          )}
        </Cell>

        <Cell label="Отклонение">
          {row.percentDiff === null ? (
            <span className="text-gray-400">—</span>
          ) : (
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${deviationTone(row.percentDiff)}`}
            >
              {row.percentDiff > DEVIATION_THRESHOLD_PP
                ? "▲ "
                : row.percentDiff < -DEVIATION_THRESHOLD_PP
                  ? "▼ "
                  : ""}
              {formatPp(row.percentDiff, 2)}
            </span>
          )}
        </Cell>

        <Cell label="К ребалансировке">
          {row.amountToBalance === null ? (
            <span className="text-gray-400">—</span>
          ) : Math.abs(row.amountToBalance) < (row.unit === "USD" ? 1 : 1e-6) ? (
            <span className="text-gray-400">в балансе</span>
          ) : (
            <span
              className={
                row.amountToBalance > 0 ? "text-emerald-700" : "text-orange-700"
              }
              title={
                row.amountToBalance > 0
                  ? `Купить ${formatAmount(row.amountToBalance, 6)} ${row.unit}`
                  : `Продать ${formatAmount(Math.abs(row.amountToBalance), 6)} ${row.unit}`
              }
            >
              {formatSignedAmount(
                row.amountToBalance,
                balanceDecimals(row.unit, row.amountToBalance),
              )}
              <span className="ml-1 text-xs text-gray-400">{row.unit}</span>
            </span>
          )}
        </Cell>
      </button>

      {row.warnings.length > 0 && (
        <ul className="px-4 pb-2 text-xs text-amber-700">
          {row.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {open && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
          {!hasDetail && (
            <p className="text-xs text-gray-500">
              Пока пусто. Залог подтянется из лендинга, остальное можно внести
              вручную на странице «Цели и записи».
            </p>
          )}

          {row.collateralDetail.length > 0 && (
            <Detail
              title={`Залог в лендинге${NBSP}·${NBSP}${formatUsd(row.breakdown.collateralUsd, 0)}`}
            >
              {row.collateralDetail.map((d) => (
                <li
                  key={`${d.walletId}-${d.chain}-${d.symbol}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 py-1"
                >
                  <span className="text-gray-700">
                    {d.symbol}
                    <span className="ml-1.5 text-xs text-gray-400">
                      {chainLabel(d.chain)}
                      {d.walletLabel ? ` · ${d.walletLabel}` : ""}
                    </span>
                  </span>
                  <span className="text-gray-600" title={formatQuantityFull(d.quantity)}>
                    {formatQuantity(d.quantity)}
                    {d.priceUsd === null ? (
                      <span className="ml-1.5 text-amber-700">нет цены</span>
                    ) : (
                      <>
                        <span className="mx-1.5 text-gray-400">×</span>
                        {formatUsd(d.priceUsd, 0)}
                        <span className="mx-1.5 text-gray-400">=</span>
                        <span className="font-medium text-gray-900">
                          {formatUsd(d.valueUsd, 0)}
                        </span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </Detail>
          )}

          {row.manualEntries.length > 0 && (
            <Detail
              title={`Внесено вручную${NBSP}·${NBSP}${formatUsd(row.breakdown.manualUsd, 0)}`}
            >
              {row.manualEntries.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 py-1"
                >
                  <span className="text-gray-700">{m.label}</span>
                  <span className="text-gray-600">
                    {formatQuantity(m.amount)}
                    <span className="ml-1 text-xs text-gray-400">{row.unit}</span>
                    <span className="mx-1.5 text-gray-400">=</span>
                    <span className="font-medium text-gray-900">
                      {formatUsd(m.valueUsd, 0)}
                    </span>
                  </span>
                </li>
              ))}
            </Detail>
          )}
        </div>
      )}
    </li>
  );
}

/** Ячейка: на мобильном — с подписью сверху, на десктопе — только значение. */
function Cell({
  label,
  strong,
  children,
}: {
  label: string;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="md:text-right">
      <span className="block text-xs text-gray-400 md:hidden">{label}</span>
      <span
        className={`text-sm ${strong ? "font-medium text-gray-900" : "text-gray-700"}`}
      >
        {children}
      </span>
    </div>
  );
}

function Detail({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-1 first:mt-0">
      <p className="text-xs font-medium text-gray-500">{title}</p>
      <ul className="mt-0.5 divide-y divide-gray-200 text-sm">{children}</ul>
    </div>
  );
}
