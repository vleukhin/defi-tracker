"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { DcCard, SectionHead } from "@/components/dc/card";
import { ASSET_COLOR } from "@/components/dc/protocols";
import { Dash, DcTable, Td, Th, Tr } from "@/components/dc/table";
import { Pagination } from "@/components/pagination";
import {
  CATEGORY_UNIT,
  TRADE_CATEGORIES,
} from "@/components/trades/categories";
import type { SnapshotDto, SnapshotItemDto } from "@/lib/api/types";
import { coinCount } from "@/lib/portfolio/coin-count";
import {
  NBSP,
  dcUsd,
  tableDate,
  tableNumber,
  tablePct,
  tableTimeUtc,
  tableUsd,
  usdDecimals,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { PartialMarker } from "./chart-parts";
import { HISTORY_CATEGORY_LABEL } from "./labels";
import { QUANTITY_DECIMALS } from "./quantity-series";

/**
 * Таблица снепшотов (README, экран 5): ДАТА · СТОИМОСТЬ · BTC · ETH ·
 * СТЕЙБЛЫ · ДОЛГ · HF. В колонках активов — КОЛИЧЕСТВА, а не доли:
 * главная метрика стратегии — сколько монет, а не сколько процентов
 * (AGENTS.md).
 *
 * Количество — это СЧЁТЧИК МОНЕТ из сырого состава точки (`coinCount`),
 * а не поле `quantity`: последнее равно стоимости, делённой на цену
 * категории, и меняется от одного движения рынка. Колонка, которая ползёт
 * без действий владельца, на вопрос «сколько я набрал» не отвечает.
 * Правило сложения разнородных токенов — в lib/portfolio/coin-count.ts.
 *
 * Эквивалент по цене из таблицы не выброшен: он лежит в раскрытом составе
 * отдельной строкой, рядом со счётчиком и стоимостью.
 *
 * Строка раскрывается в полный состав на дату (S3.2) — как строки категорий
 * в таблице портфеля. Состав, цена и эквивалент приходят null (а не нулём),
 * когда данных на момент съёма не было: показываем «—», не «0».
 */

/** Состава в точке нет — счёт монет не из чего сложить; ноль был бы враньём. */
const NO_COMPOSITION =
  "Сырой состав на эту дату не сохранён — счётчик монет не из чего сложить. " +
  "Эквивалент по цене есть в раскрытой строке.";

/**
 * Два числа рядом неизбежно вызывают вопрос «почему они разные» — отвечаем
 * заранее: счётчик складывает токены по номиналу, эквивалент пересчитывает
 * их стоимость в цену категории (подробности — lib/portfolio/coin-count.ts).
 */
const COINS_HINT =
  "Сумма монет в составе по номиналу: 1 wstETH считается за 1 ETH, " +
  "1 WBTC — за 1 BTC. От цен не зависит, поэтому меняется только от ваших " +
  "действий и начисленных процентов.";

const EQUIVALENT_HINT =
  "Стоимость категории, делённая на цену базового актива. Выше счётчика " +
  "монет ровно настолько, насколько обёртки и LST дороже базового актива. " +
  "Зависит от цен и меняется каждый день.";

const HF_HINT =
  "Health Factor на дату снепшота не сохраняется — в истории колонка остаётся пустой. Текущее значение живёт на странице «Долг».";

/** Снепшотов на странице: за год их сотни, весь список нечитаем. */
const PAGE_SIZE = 20;

/** Порядок состава фиксирован — как в таблице портфеля. */
function orderedItems(snapshot: SnapshotDto): SnapshotItemDto[] {
  return TRADE_CATEGORIES.map(
    (c) =>
      snapshot.items.find((i) => i.category === c.key) ?? {
        category: c.key,
        quantity: null,
        // Категории в точке нет вовсе — состава тоже; пустой состав здесь
        // означал бы «монет не было», а правильный ответ «не записано»
        composition: null,
        priceUsd: null,
        valueUsd: 0,
        percent: 0,
        collateralUsd: 0,
        manualUsd: 0,
        freeUsd: 0,
      },
  );
}

export function SnapshotsList({ snapshots }: { snapshots: SnapshotDto[] }) {
  // Новые сверху: список читается «что было вчера», в отличие от графика
  const all = [...snapshots].reverse();
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Нарезка на клиенте: графикам нужен весь ряд, поэтому данные уже
  // загружены целиком — второй запрос за страницей был бы лишним.
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = all.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <DcCard as="section">
      <SectionHead
        title="Снепшоты"
        count={all.length}
        hint="Точка истории за календарный день. В колонках BTC, ETH и стейблов — количество монет из сохранённого состава: от движения цен оно не зависит. Строка раскрывается в состав портфеля на эту дату — количества, цены и разбивку «залог / вручную»."
        className="border-line border-b"
      />

      <DcTable minWidth={820}>
        <thead>
          <tr>
            <Th>Дата</Th>
            <Th numeric>Стоимость</Th>
            {TRADE_CATEGORIES.map((c) => (
              <Th key={c.key} numeric>
                {HISTORY_CATEGORY_LABEL[c.key]}
              </Th>
            ))}
            <Th numeric>Долг</Th>
            <Th numeric title={HF_HINT}>
              HF
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((snapshot) => {
            const open = openId === snapshot.id;
            const items = orderedItems(snapshot);
            return (
              <Fragment key={snapshot.id}>
                <Tr>
                  <Td>
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? null : snapshot.id)}
                      aria-expanded={open}
                      title="Показать состав на дату"
                      className="flex items-center gap-1.5 rounded-pill font-mono text-[12.5px] text-text-2 outline-none transition-colors duration-120 ease-out pointer-coarse:min-h-11 hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <ChevronRight
                        aria-hidden
                        className={cn(
                          "size-3.5 text-text-4 transition-transform duration-150",
                          open && "rotate-90",
                        )}
                      />
                      {tableDate(snapshot.takenOn)}
                      {snapshot.isPartial && (
                        <PartialMarker className="ml-0.5 inline-block size-2 bg-surface align-middle" />
                      )}
                    </button>
                  </Td>
                  <Td numeric mono>
                    {dcUsd(snapshot.totalUsd)}
                  </Td>
                  {items.map((item) => {
                    const coins = coinCount(item.composition);
                    return (
                      <Td
                        key={item.category}
                        numeric
                        mono
                        muted
                        title={coins === null ? NO_COMPOSITION : undefined}
                      >
                        {coins === null ? (
                          <Dash />
                        ) : (
                          tableNumber(
                            coins,
                            QUANTITY_DECIMALS[item.category],
                          )
                        )}
                      </Td>
                    );
                  })}
                  <Td numeric mono muted>
                    {snapshot.debtUsd === null ? (
                      <Dash />
                    ) : (
                      dcUsd(snapshot.debtUsd)
                    )}
                  </Td>
                  {/* Health Factor в снепшоте не хранится — колонка честно
                      пустая, а не заполненная пересчётом задним числом */}
                  <Td numeric mono muted>
                    <Dash />
                  </Td>
                </Tr>

                {open && (
                  <tr className="border-line border-b">
                    <td colSpan={7} className="bg-sunken px-card py-3.5">
                      <SnapshotDetail snapshot={snapshot} items={items} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </DcTable>

      <div className="border-line border-t bg-sunken px-card py-3">
        <Pagination
          page={safePage}
          pageSize={PAGE_SIZE}
          total={all.length}
          totalPages={totalPages}
          onPage={setPage}
        />
      </div>
    </DcCard>
  );
}

/** Полный состав портфеля на дату: количество, цена, стоимость, разбивка. */
function SnapshotDetail({
  snapshot,
  items,
}: {
  snapshot: SnapshotDto;
  items: SnapshotItemDto[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="t-meta text-text-3">
        Состав на{" "}
        <span className="font-mono">{tableDate(snapshot.takenOn)}</span>
        {NBSP}·{NBSP}снят{" "}
        <span className="font-mono">
          {tableTimeUtc(snapshot.takenAt)} UTC
        </span>
      </p>

      <div className="grid gap-px bg-line sm:grid-cols-3">
        {items.map((item) => {
          const unit = CATEGORY_UNIT[item.category];
          const decimals = QUANTITY_DECIMALS[item.category];
          const coins = coinCount(item.composition);
          return (
            <div key={item.category} className="bg-surface px-card py-3.5">
              <div className="flex items-baseline gap-2">
                <span
                  aria-hidden
                  className="size-[7px] shrink-0 translate-y-[-1px] rounded-full"
                  style={{ background: ASSET_COLOR[item.category] }}
                />
                <span className="text-[13px] font-medium">
                  {HISTORY_CATEGORY_LABEL[item.category]}
                </span>
                <span className="ml-auto font-mono text-[13px]">
                  {dcUsd(item.valueUsd)}
                </span>
              </div>

              <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
                <Detail label="Монет" hint={COINS_HINT}>
                  {coins === null ? (
                    <NoData title={NO_COMPOSITION} />
                  ) : (
                    <>
                      {tableNumber(coins, decimals)}
                      <span className="ml-1 font-sans text-[12px] text-text-3">
                        {unit}
                      </span>
                    </>
                  )}
                </Detail>
                {/* Эквивалент по цене — та самая величина, которой раньше
                    была колонка. Осталась рядом: по ней видно, насколько
                    обёртки и LST дороже базового актива */}
                <Detail label="Эквивалент" hint={EQUIVALENT_HINT}>
                  {item.quantity === null ? (
                    <NoData title="цены на момент съёма не было — эквивалент не выводится" />
                  ) : (
                    <>
                      {tableNumber(item.quantity, decimals)}
                      <span className="ml-1 font-sans text-[12px] text-text-3">
                        {unit}
                      </span>
                    </>
                  )}
                </Detail>
                <Detail label="Цена">
                  {item.priceUsd === null ? (
                    <NoData title="цены на момент съёма не было" />
                  ) : (
                    tableUsd(item.priceUsd, usdDecimals(item.priceUsd))
                  )}
                </Detail>
                <Detail label="Доля">{tablePct(item.percent)}</Detail>
                <Detail label="Залог / вручную">
                  {dcUsd(item.collateralUsd)}
                  <span className="mx-1 font-sans text-text-4">/</span>
                  {dcUsd(item.manualUsd)}
                </Detail>
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Detail({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="t-label" title={hint}>
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[13px]">{children}</dd>
    </div>
  );
}

/** Ноль и «неизвестно» — разные вещи, и выглядят по-разному. */
function NoData({ title }: { title: string }) {
  return (
    <span className="font-sans text-text-3" title={title}>
      нет данных
    </span>
  );
}
