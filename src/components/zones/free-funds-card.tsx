"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DcCard, SectionHead } from "@/components/dc/card";
import { StatusChip, ZoneChip } from "@/components/dc/chip";
import { Segmented } from "@/components/dc/segmented";
import { DcTable, Td, Th, Tr } from "@/components/dc/table";
import { countLabel } from "@/components/portfolio/plural";
import type { FreeBalanceDto, FundsMark } from "@/lib/api/types";
import { chainLabel, dcUsd, tableQuantity } from "@/lib/format";
import { categoryColor, symbolCategory } from "@/lib/symbol-category";
import { ApiError, apiFetch } from "@/lib/use-api";
import { cn } from "@/lib/utils";

/**
 * «Свободные средства» — деньги, которые лежат на кошельке и не участвуют
 * ни в залоге, ни в позициях.
 *
 * Стоит перед списком позиций намеренно: это единственные деньги, которые
 * прямо сейчас ничего не делают, и решение по ним требуется раньше, чем
 * взгляд на уже работающий капитал.
 *
 * Разметка живёт здесь, а не на «Кошельках», по той же причине, по которой
 * разметка позиции живёт на карточке позиции: следствие метки видно тут же —
 * заёмные уезжают в Yield, а из категории уходят.
 *
 * Переключатель на три состояния, а не поповер: поле ровно одно, и поповер
 * ради одного переключателя — лишний шаг.
 */

const FREE_HINT =
  "Монеты на кошельке вне залога и позиций. Заёмные не входят в три категории — портфель ведётся по собственным средствам, — но входят в «Активы» и в зону Yield. Не размеченные считаются своими.";

const FUNDS_OPTIONS: { value: FundsMark | "unset"; label: string }[] = [
  { value: "own", label: "Свои" },
  { value: "borrowed", label: "Заёмные" },
  // «—» = снять разметку. Отдельное состояние, а не «свои»: молчание
  // и утверждение «это мои деньги» — разные вещи
  { value: "unset", label: "—" },
];

export interface FreeSummary {
  ownUsd: number;
  borrowedUsd: number;
  unmarkedCount: number;
  dust: { count: number; valueUsd: number };
  other: {
    walletId: string;
    walletLabel: string | null;
    chain: string;
    symbol: string;
    quantity: string;
  }[];
}

export function FreeFundsCard({
  balances,
  summary,
  onRefetch,
}: {
  balances: FreeBalanceDto[];
  summary: FreeSummary;
  onRefetch: () => Promise<void>;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const totalUsd = summary.ownUsd + summary.borrowedUsd;

  async function mark(balance: FreeBalanceDto, value: FundsMark | "unset") {
    setBusyKey(balance.key);
    try {
      await apiFetch("/api/balances/mark", {
        method: "PUT",
        body: JSON.stringify({
          walletId: balance.walletId,
          chain: balance.chain,
          token: balance.token,
          funds: value === "unset" ? null : value,
        }),
      });
      await onRefetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Не удалось сохранить разметку",
      );
    } finally {
      setBusyKey(null);
    }
  }

  const hasNothing =
    balances.length === 0 &&
    summary.dust.count === 0 &&
    summary.other.length === 0;
  if (hasNothing) return null;

  return (
    <DcCard as="section" className="mt-3.5 px-card py-card">
      <SectionHead
        title="Свободные средства"
        hint={FREE_HINT}
        count={balances.length > 0 ? dcUsd(totalUsd) : undefined}
        note={
          balances.length > 0
            ? `Свои ${dcUsd(summary.ownUsd)} · заёмные ${dcUsd(summary.borrowedUsd)}`
            : undefined
        }
      />

      {summary.unmarkedCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusChip tone="warn">
            {countLabel(
              summary.unmarkedCount,
              "баланс без разметки",
              "баланса без разметки",
              "балансов без разметки",
            )}
          </StatusChip>
          <p className="t-meta min-w-0 text-text-2">
            Считаются своими и входят в категории. Пометьте заёмные, чтобы они
            ушли в Yield и перестали раздувать долю.
          </p>
        </div>
      )}

      {/* До sm список раскладывается карточками. Причина не в ширине как
          таковой: «Происхождение» — шестая колонка таблицы в 720px, то есть
          примерно 600-я точка по горизонтали. Карточка выше зовёт пометить
          заёмные, а сам переключатель на телефоне приходилось искать
          горизонтальной прокруткой вслепую. */}
      {balances.length > 0 && (
        <ul className="mt-3.5 flex flex-col gap-2 sm:hidden">
          {balances.map((b) => (
            <li
              key={b.key}
              className="flex flex-col gap-2.5 rounded-block bg-sunken px-3 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-2 font-medium text-[13.5px]">
                  <span
                    aria-hidden
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ background: categoryColor(b.symbol) }}
                  />
                  {b.symbol}
                  <span className="font-normal text-[12px] text-text-3">
                    {chainLabel(b.chain)}
                    {b.walletLabel ? ` · ${b.walletLabel}` : ""}
                  </span>
                </span>
                <ZoneChip
                  zone={b.funds === "borrowed" ? "yield" : zoneOf(b.symbol)}
                />
              </div>

              <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-[13px]">
                <span>{tableQuantity(b.quantity)}</span>
                <span
                  className={b.countedInCategory ? "text-text-2" : "text-text-3"}
                >
                  {dcUsd(b.valueUsd)}
                </span>
                {!b.countedInCategory && (
                  <span className="font-sans text-[12px] text-text-3">
                    заёмные — вне категории
                  </span>
                )}
              </p>

              <Segmented
                options={FUNDS_OPTIONS}
                value={b.funds ?? "unset"}
                onChange={(v) => void mark(b, v)}
                ariaLabel={`Происхождение ${b.symbol} в сети ${chainLabel(b.chain)}`}
                className={cn("w-full", busyKey === b.key && "opacity-60")}
              />
            </li>
          ))}
        </ul>
      )}

      {balances.length > 0 && (
        <div className="mt-3.5 max-sm:hidden">
          <DcTable minWidth={720}>
            <thead>
              <tr>
                <Th>Токен</Th>
                <Th>Сеть</Th>
                <Th>Кошелёк</Th>
                <Th numeric>Количество</Th>
                <Th numeric>Стоимость</Th>
                <Th>Происхождение</Th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <Tr key={b.key}>
                  <Td>
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block size-2 shrink-0 rounded-full"
                        style={{ background: categoryColor(b.symbol) }}
                      />
                      {b.symbol}
                    </span>
                  </Td>
                  <Td>{chainLabel(b.chain)}</Td>
                  <Td className="text-text-2">{b.walletLabel ?? "—"}</Td>
                  <Td numeric>{tableQuantity(b.quantity)}</Td>
                  <Td numeric>
                    <span
                      className={b.countedInCategory ? undefined : "text-text-3"}
                      title={
                        b.countedInCategory
                          ? undefined
                          : "Заёмные в стоимость категории не входят"
                      }
                    >
                      {dcUsd(b.valueUsd)}
                    </span>
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-2">
                      <Segmented
                        options={FUNDS_OPTIONS}
                        value={b.funds ?? "unset"}
                        onChange={(v) => void mark(b, v)}
                        ariaLabel={`Происхождение ${b.symbol} в сети ${chainLabel(b.chain)}`}
                        className={busyKey === b.key ? "opacity-60" : undefined}
                      />
                      <ZoneChip
                        zone={b.funds === "borrowed" ? "yield" : zoneOf(b.symbol)}
                      />
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DcTable>
        </div>
      )}

      {(summary.dust.count > 0 || summary.other.length > 0) && (
        <div className="mt-3 space-y-1 text-[12.5px] text-text-3">
          {summary.dust.count > 0 && (
            <p>
              Скрыто{" "}
              {countLabel(summary.dust.count, "баланс", "баланса", "балансов")}{" "}
              дешевле $1 на {dcUsd(summary.dust.valueUsd)}
            </p>
          )}
          {summary.other.length > 0 && (
            <p>
              Вне трёх категорий:{" "}
              {summary.other
                .map((o) => `${tableQuantity(o.quantity)} ${o.symbol}`)
                .join(" · ")}
            </p>
          )}
        </div>
      )}
    </DcCard>
  );
}

/** Зона свободного баланса без разметки — та же, что в движке зон. */
function zoneOf(symbol: string) {
  return symbolCategory(symbol) === "stable"
    ? ("stability" as const)
    : ("growth" as const);
}
