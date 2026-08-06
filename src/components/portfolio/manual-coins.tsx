"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DcCard, EmptyState, SectionHead } from "@/components/dc/card";
import { Segmented } from "@/components/dc/segmented";
import { DcTable, Td, Th, Tr } from "@/components/dc/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  ManualListDto,
  PortfolioCategory,
  PortfolioRowDto,
} from "@/lib/api/types";
import { dcUsd, tableQuantity } from "@/lib/format";
import { ApiError, apiFetch } from "@/lib/use-api";
import { CATEGORIES as TARGET_CATEGORIES } from "./category";
import { CategoryDot } from "./category";

/**
 * «Монеты вручную» (README §8). Раньше на экране висели три одинаковых
 * блока — по одному на категорию; теперь один: категория выбирается
 * сегментом, а таблица показывает все записи сразу и сравнима построчно.
 *
 * Стоимость берётся из движка портфеля (`rows[].manualEntries`), где
 * количество уже оценено по цене категории. Пока портфель не загружен —
 * «—», а не «$0,00»: ноль и «неизвестно» выглядят по-разному (§9).
 */

const PLACEHOLDER_LABEL: Record<PortfolioCategory, string> = {
  btc: "Биржа, холодный кошелёк",
  eth: "Биржа, холодный кошелёк",
  stable: "GMX пул",
};

const PLACEHOLDER_AMOUNT: Record<PortfolioCategory, string> = {
  btc: "0,5",
  eth: "2,5",
  stable: "15000",
};

function pluralEntries(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "запись";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "записи";
  return "записей";
}

export function ManualCoinsCard({
  entries,
  rows,
  onChanged,
}: {
  /** null — ещё грузим. */
  entries: ManualListDto["entries"] | null;
  /** null — портфель ещё не пришёл: стоимости неизвестны. */
  rows: PortfolioRowDto[] | null;
  onChanged: () => void;
}) {
  const [category, setCategory] = useState<PortfolioCategory>("btc");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // id записи → стоимость в долларах, посчитанная движком портфеля
  const valueById = new Map<string, number>();
  for (const row of rows ?? []) {
    for (const e of row.manualEntries) valueById.set(e.id, e.valueUsd);
  }

  const list = entries ?? [];

  /**
   * Категории, где ручные записи соседствуют с прочитанными балансами.
   * Ровно тот случай, когда «холодный кошелёк» из записи может оказаться
   * одним из добавленных адресов — и тогда деньги посчитаны дважды.
   */
  const duplicateRisk = (rows ?? [])
    .filter(
      (row) =>
        row.freeBalances.length > 0 &&
        list.some((e) => e.category === row.category),
    )
    .map((row) => row.label);

  /**
   * Сумма считается только по записям этого списка, а не по всему
   * `manualEntries` из /api/portfolio: движок кладёт туда ещё и
   * собственные доли позиций синтетическими строками (`pos:*`), и они
   * к ручным монетам отношения не имеют. Иначе карточка при пустом
   * списке писала «0 записей · $38 948».
   */
  const totalUsd =
    rows === null || entries === null
      ? null
      : list.reduce((sum, e) => sum + (valueById.get(e.id) ?? 0), 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiFetch("/api/portfolio/manual", {
        method: "POST",
        body: JSON.stringify({ category, label, amount }),
      });
      setLabel("");
      setAmount("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось добавить");
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string, entryLabel: string) {
    setError(null);
    try {
      await apiFetch(`/api/portfolio/manual/${id}`, { method: "DELETE" });
      onChanged();
      toast.success(`Запись «${entryLabel}» удалена`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить");
    }
  }

  return (
    <DcCard as="section">
      <SectionHead
        title="Монеты вручную"
        hint="Залог в лендинге и свободные монеты на добавленных кошельках читаются автоматически — вносить их сюда не надо. Здесь только то, чего приложение не видит: биржа, кошелёк вне списка, проинвестированные стейблы."
        action={
          entries === null ? null : (
            <span className="t-meta shrink-0 text-text-3">
              {list.length} {pluralEntries(list.length)}
              {/* Пустому списку сумма не нужна: «0 записей · $0» — шум */}
              {totalUsd === null || list.length === 0
                ? ""
                : ` · ${dcUsd(totalUsd)}`}
            </span>
          )
        }
        className="border-line border-b"
      />

      <form
        onSubmit={add}
        className="flex flex-col gap-2.5 border-line border-b bg-sunken px-card py-3.5"
      >
        <Segmented
          ariaLabel="Актив записи"
          value={category}
          onChange={setCategory}
          options={TARGET_CATEGORIES.map((c) => ({
            value: c.key,
            label: (
              <span className="flex items-center justify-center gap-1.5">
                <CategoryDot category={c.key} size={6} />
                {c.label}
              </span>
            ),
          }))}
        />

        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            type="text"
            required
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={PLACEHOLDER_LABEL[category]}
            aria-label="Где лежит"
            className="min-w-[140px] flex-1 text-base md:text-[13px]"
          />
          <Input
            type="text"
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={PLACEHOLDER_AMOUNT[category]}
            aria-label={
              category === "stable" ? "Сумма в долларах" : "Количество монет"
            }
            className="w-[120px] shrink-0 text-right font-mono text-base sm:w-[96px] md:text-[13px]"
          />
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Добавление…" : "Добавить"}
          </Button>
        </div>

        {error && (
          <p role="status" className="t-meta text-loss">
            {error}
          </p>
        )}
      </form>

      {/* Предупреждение о возможном двойном счёте. Автоматически отличить
          биржевой баланс от кошелькового нельзя — их не сравнить ни по
          сумме, ни по подписи, — поэтому решение остаётся за человеком:
          неттинг и тем более автоудаление записи здесь были бы догадкой. */}
      {duplicateRisk.length > 0 && list.length > 0 && (
        <p className="t-meta border-line border-b bg-sunken px-card py-2.5 text-text-2">
          {duplicateRisk.join(" и ")}{" "}
          {duplicateRisk.length > 1 ? "читаются" : "читается"} и с кошельков.
          Если запись описывает те же деньги — удалите её, иначе они посчитаны
          дважды.
        </p>
      )}

      {entries === null ? (
        <div className="flex flex-col gap-2 px-card py-4" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[19px] rounded-pill bg-chip" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState title="Записей пока нет — добавьте монеты вне лендинга" />
      ) : (
        <DcTable minWidth={480}>
          <thead>
            <tr>
              <Th>Актив</Th>
              <Th>Где</Th>
              <Th numeric>Кол-во</Th>
              <Th numeric>Стоимость</Th>
              <Th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {list.map((e) => {
              const value = valueById.get(e.id);
              const meta = TARGET_CATEGORIES.find((c) => c.key === e.category);
              return (
                <Tr key={e.id}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <CategoryDot category={e.category} size={6} />
                      {meta?.label ?? e.category}
                    </span>
                  </Td>
                  <Td className="text-text-2">
                    <span className="block max-w-[220px] truncate">
                      {e.label}
                    </span>
                  </Td>
                  <Td numeric mono>
                    {tableQuantity(e.amount)}
                  </Td>
                  <Td numeric mono muted>
                    {value === undefined ? "—" : dcUsd(value)}
                  </Td>
                  <Td numeric className="py-1.5">
                    <button
                      type="button"
                      onClick={() => void remove(e.id, e.label)}
                      aria-label={`Удалить запись «${e.label}»`}
                      className="-mr-1 rounded-control px-2 py-2.5 text-[12.5px] text-text-4 outline-none transition-colors duration-120 ease-out hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      удалить
                    </button>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DcTable>
      )}
    </DcCard>
  );
}
