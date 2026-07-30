"use client";

import { Fragment, useState } from "react";
import type { PortfolioRowDto } from "@/lib/api/types";
import {
  DEVIATION_THRESHOLD_PP,
  chainLabel,
  tableNumber,
  tableQuantity,
  tablePct,
  tablePctSigned,
  tableSigned,
  tableUsd,
} from "@/lib/format";

/**
 * Таблица портфеля в виде рабочей таблицы пользователя (S1.7):
 * сетка с границами ячеек, числа выровнены по правому краю, десятичная
 * запятая, фиксированная точность с сохранением нулей, итог — в колонке
 * стоимости. Столбцы 1:1 повторяют исходную таблицу:
 * Количество · Стоимость USD · Цена · Доля · Цель · Отклонение · К ребалансировке.
 *
 * Единственное расширение против таблицы — раскрытие строки в состав
 * (залог по сетям и ручные записи): без него не видно, из чего собрано
 * количество. Раскрытие оформлено сдержанно, чтобы не ломать вид таблицы.
 *
 * На узких экранах (< md) сетка заменяется стеком карточек: таблица из
 * восьми колонок на 375 px нечитаема.
 */

/** Знаков в количестве: у стейблов дробная часть не нужна. */
function amountDecimals(unit: string): number {
  return unit === "USD" ? 0 : 4;
}

/**
 * Точность количества к ребалансировке подстраивается под масштаб:
 * −0,071486 BTC нужно видеть целиком, а у −3 732,86 ETH шесть знаков
 * только ломают верстку.
 */
function balanceDecimals(unit: string, value: number): number {
  if (unit === "USD") return 0;
  const abs = Math.abs(value);
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  return 6;
}

/** Подсказка к знаку: минус — продать, плюс — купить. */
function balanceHint(value: number, unit: string): string {
  const body = `${tableNumber(Math.abs(value), balanceDecimals(unit, value))} ${unit}`;
  return value > 0 ? `Купить ${body}` : `Продать ${body}`;
}

function deviationClass(diff: number): string {
  if (diff > DEVIATION_THRESHOLD_PP) return "font-medium text-orange-700";
  if (diff < -DEVIATION_THRESHOLD_PP) return "font-medium text-sky-700";
  return "";
}

const COLUMNS = [
  "Количество",
  "Стоимость USD",
  "Цена",
  "Доля",
  "Цель",
  "Отклонение",
  "К ребалансировке",
];

/** Общие классы ячейки: границы сетки + выравнивание чисел вправо. */
const CELL = "border border-gray-200 px-3 py-2 text-right tabular-nums";
const HEAD = "border border-gray-200 bg-gray-50 px-3 py-2 font-medium";

export function PortfolioTable({
  rows,
  totalUsd,
}: {
  rows: PortfolioRowDto[];
  totalUsd: number;
}) {
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  return (
    <>
      {/* Табличный вид — от md и шире */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-xs text-gray-600">
              {/* Угловая ячейка пустая — как в исходной таблице */}
              <th className={`${HEAD} text-left`} />
              {COLUMNS.map((c) => (
                <th key={c} className={`${HEAD} text-right`} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const open = openCategory === row.category;
              const detailCount =
                row.collateralDetail.length + row.manualEntries.length;
              return (
                <Fragment key={row.category}>
                  <tr className="hover:bg-gray-50">
                    <th
                      scope="row"
                      className="border border-gray-200 px-3 py-2 text-left font-normal"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenCategory(open ? null : row.category)
                        }
                        aria-expanded={open}
                        className="flex items-center gap-1.5 text-gray-900"
                        title={
                          detailCount > 0
                            ? "Показать состав"
                            : "Состав пока пуст"
                        }
                      >
                        <span className="text-[10px] text-gray-400">
                          {open ? "▾" : "▸"}
                        </span>
                        {row.label}
                      </button>
                    </th>

                    <td className={CELL}>
                      {row.amount === null ? (
                        <span className="text-gray-400">нет цены</span>
                      ) : (
                        tableNumber(row.amount, amountDecimals(row.unit))
                      )}
                    </td>

                    <td className={CELL}>{tableUsd(row.amountUsd)}</td>

                    <td className={CELL}>
                      {row.price === null ? "—" : tableUsd(row.price)}
                      {row.priceStale && (
                        <span
                          className="ml-1 text-xs text-amber-600"
                          title="Цена устарела: не удалось обновить"
                        >
                          !
                        </span>
                      )}
                    </td>

                    <td className={CELL}>{tablePct(row.percent)}</td>

                    <td className={CELL}>
                      {row.targetPercent === null ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        tablePct(row.targetPercent)
                      )}
                    </td>

                    <td
                      className={`${CELL} ${
                        row.percentDiff === null
                          ? ""
                          : deviationClass(row.percentDiff)
                      }`}
                    >
                      {row.percentDiff === null ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        tablePctSigned(row.percentDiff)
                      )}
                    </td>

                    <td className={CELL}>
                      {row.amountToBalance === null ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <span title={balanceHint(row.amountToBalance, row.unit)}>
                          {tableSigned(
                            row.amountToBalance,
                            balanceDecimals(row.unit, row.amountToBalance),
                          )}
                        </span>
                      )}
                    </td>
                  </tr>

                  {row.warnings.length > 0 && (
                    <tr>
                      <td
                        colSpan={COLUMNS.length + 1}
                        className="border border-gray-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800"
                      >
                        {row.warnings.map((w) => (
                          <span key={w} className="mr-3">
                            ⚠ {w}
                          </span>
                        ))}
                      </td>
                    </tr>
                  )}

                  {open && (
                    <tr>
                      <td
                        colSpan={COLUMNS.length + 1}
                        className="border border-gray-200 bg-gray-50 px-3 py-2"
                      >
                        <RowDetail row={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {/* Итог — в колонке стоимости, как в исходной таблице */}
            <tr>
              <th scope="row" className={`${HEAD} text-left text-gray-600`} />
              <td className={`${CELL} bg-gray-50`} />
              <td className={`${CELL} bg-gray-50 font-semibold`}>
                {tableUsd(totalUsd)}
              </td>
              <td className={`${CELL} bg-gray-50`} colSpan={5} />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Мобильный вид: восемь колонок на 375 px нечитаемы */}
      <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white md:hidden">
        {rows.map((row) => (
          <MobileCard
            key={row.category}
            row={row}
            open={openCategory === row.category}
            onToggle={() =>
              setOpenCategory(openCategory === row.category ? null : row.category)
            }
          />
        ))}
        <li className="flex items-baseline justify-between bg-gray-50 px-4 py-2.5">
          <span className="text-sm text-gray-500">Итого</span>
          <span className="text-base font-semibold tabular-nums">
            {tableUsd(totalUsd)}
          </span>
        </li>
      </ul>
    </>
  );
}

function MobileCard({
  row,
  open,
  onToggle,
}: {
  row: PortfolioRowDto;
  open: boolean;
  onToggle: () => void;
}) {
  const pairs: [string, React.ReactNode][] = [
    [
      "Количество",
      row.amount === null
        ? "нет цены"
        : tableNumber(row.amount, amountDecimals(row.unit)),
    ],
    ["Стоимость USD", tableUsd(row.amountUsd)],
    ["Цена", row.price === null ? "—" : tableUsd(row.price)],
    ["Доля", tablePct(row.percent)],
    ["Цель", row.targetPercent === null ? "—" : tablePct(row.targetPercent)],
    [
      "Отклонение",
      row.percentDiff === null ? (
        "—"
      ) : (
        <span className={deviationClass(row.percentDiff)}>
          {tablePctSigned(row.percentDiff)}
        </span>
      ),
    ],
    [
      "К ребалансировке",
      row.amountToBalance === null
        ? "—"
        : tableSigned(
            row.amountToBalance,
            balanceDecimals(row.unit, row.amountToBalance),
          ),
    ],
  ];

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full px-4 py-3 text-left hover:bg-gray-50"
      >
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400">{open ? "▾" : "▸"}</span>
          <span className="text-sm font-medium text-gray-900">{row.label}</span>
          <span className="ml-auto text-sm font-semibold tabular-nums">
            {tableUsd(row.amountUsd)}
          </span>
        </span>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          {pairs.slice(0, 1).concat(pairs.slice(2)).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-gray-400">{label}</dt>
              <dd className="text-sm tabular-nums text-gray-800">{value}</dd>
            </div>
          ))}
        </dl>
      </button>

      {row.warnings.length > 0 && (
        <ul className="bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
          {row.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {open && (
        <div className="bg-gray-50 px-4 py-2">
          <RowDetail row={row} />
        </div>
      )}
    </li>
  );
}

/** Состав категории: залог по сетям и ручные записи. */
function RowDetail({ row }: { row: PortfolioRowDto }) {
  const empty =
    row.collateralDetail.length === 0 && row.manualEntries.length === 0;

  if (empty) {
    return (
      <p className="text-xs text-gray-500">
        Пока пусто. Залог подтянется из лендинга, остальное вносится вручную на
        странице «Цели и записи».
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {row.collateralDetail.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500">
            Залог в лендинге · {tableUsd(row.breakdown.collateralUsd)}
          </p>
          <ul className="mt-0.5 divide-y divide-gray-200 text-sm">
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
                <span
                  className="tabular-nums text-gray-600"
                  title={tableQuantity(d.quantity, true)}
                >
                  {tableQuantity(d.quantity)}
                  {d.priceUsd === null ? (
                    <span className="ml-1.5 text-amber-700">нет цены</span>
                  ) : (
                    <>
                      <span className="mx-1.5 text-gray-400">×</span>
                      {tableUsd(d.priceUsd)}
                      <span className="mx-1.5 text-gray-400">=</span>
                      <span className="font-medium text-gray-900">
                        {tableUsd(d.valueUsd)}
                      </span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.manualEntries.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500">
            Внесено вручную · {tableUsd(row.breakdown.manualUsd)}
          </p>
          <ul className="mt-0.5 divide-y divide-gray-200 text-sm">
            {row.manualEntries.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 py-1"
              >
                <span className="text-gray-700">{m.label}</span>
                <span className="tabular-nums text-gray-600">
                  {tableQuantity(m.amount)}
                  <span className="ml-1 text-xs text-gray-400">{row.unit}</span>
                  <span className="mx-1.5 text-gray-400">=</span>
                  <span className="font-medium text-gray-900">
                    {tableUsd(m.valueUsd)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
