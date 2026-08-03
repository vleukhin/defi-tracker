"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DepositsJournal } from "@/components/deposits/deposits-journal";
import { DcCard, Disclaimer, SectionHead } from "@/components/dc/card";
import { StatusChip } from "@/components/dc/chip";
import { DcTable, Td, Th, Tr } from "@/components/dc/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  ManualListDto,
  PortfolioCategory,
  PortfolioDto,
  PortfolioRowDto,
  TargetsResponseDto,
} from "@/lib/api/types";
import {
  DEVIATION_THRESHOLD_PP,
  dcPp,
  dcUsdSigned,
  tablePct,
  tableSigned,
} from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { CATEGORIES as TARGET_CATEGORIES } from "./category";
import { CATEGORY_VAR, CategoryDot } from "./category";
import { ManualCoinsCard } from "./manual-coins";

/**
 * Экран «Цели и записи» (дизайн-код, README §8) — три карточки:
 * целевые доли, монеты вручную, внесённые деньги.
 *
 * Категории фиксированы: BTC, ETH, стейблы. Главная метрика стратегии —
 * количество монет, поэтому «К ребалансировке» ведёт количеством,
 * а сумма в долларах идёт второй строкой.
 *
 * Primary-кнопка на экране одна (§5): «Сохранить цели». «Добавить»
 * и «Записать» — secondary: они дописывают журнал, а не задают стратегию.
 */

export function TargetsManager() {
  const portfolio = useApi<PortfolioDto>("/api/portfolio");
  const [entries, setEntries] = useState<ManualListDto["entries"] | null>(null);

  const loadEntries = useCallback(
    () =>
      apiFetch<ManualListDto>("/api/portfolio/manual").then(
        (res) => setEntries(res.entries),
        () => setEntries([]),
      ),
    [],
  );

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const refetchPortfolio = portfolio.refetch;
  // Ручная запись меняет и список, и доли категорий — перечитываем оба
  const onEntriesChanged = useCallback(() => {
    void loadEntries();
    void refetchPortfolio();
  }, [loadEntries, refetchPortfolio]);

  const rows = portfolio.data?.rows ?? null;

  return (
    // HelpTip опирается на radix-tooltip: провайдер обязан быть выше по дереву
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        <TargetsCard
          rows={rows}
          totalUsd={portfolio.data?.totalUsd ?? null}
          onSaved={refetchPortfolio}
        />

        {/* min-w-0 обязателен: без него горизонтальный скролл таблицы
            распирает колонку грида вместо того, чтобы включиться */}
        <div className="grid items-start gap-3 [&>*]:min-w-0 lg:grid-cols-[1.2fr_1fr]">
          <ManualCoinsCard
            entries={entries}
            rows={rows}
            onChanged={onEntriesChanged}
          />
          <DepositsJournal
            profitUsd={portfolio.data?.overview.profitUsd ?? null}
            profitLoading={portfolio.data === null && portfolio.loading}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Целевые доли                                                            */
/* -------------------------------------------------------------------------- */

function TargetsCard({
  rows,
  totalUsd,
  onSaved,
}: {
  rows: PortfolioRowDto[] | null;
  totalUsd: number | null;
  onSaved: () => Promise<void> | void;
}) {
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<TargetsResponseDto>("/api/portfolio/targets").then(
      (res) => {
        const next: Record<string, string> = {};
        for (const t of res.targets) next[t.category] = String(t.targetPct);
        setTargets(next);
      },
      () => setTargets({}),
    );
  }, []);

  const parsed = TARGET_CATEGORIES.map((c) => {
    const raw = (targets[c.key] ?? "").trim();
    const value = Number.parseFloat(raw.replace(",", "."));
    return { key: c.key, raw, value: Number.isFinite(value) ? value : null };
  });

  const sum =
    Math.round(parsed.reduce((acc, p) => acc + (p.value ?? 0), 0) * 1000) / 1000;
  const sumIs100 = Math.abs(sum - 100) < 0.001;
  const allEmpty = parsed.every((p) => p.raw === "");
  // Сумма ≠ 100% блокирует сохранение (README §8). Исключение — пустые поля:
  // это сброс целей, а не кривая раскладка.
  const canSave = sumIs100 || allEmpty;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = parsed.flatMap((p) =>
        p.raw === "" || p.value === null
          ? []
          : [{ category: p.key, targetPct: p.value }],
      );
      const res = await apiFetch<TargetsResponseDto>("/api/portfolio/targets", {
        method: "PUT",
        body: JSON.stringify({ targets: payload }),
      });
      if (res.warning) toast.warning(`Сохранено. ${res.warning}`);
      else toast.success("Цели сохранены");
      await onSaved();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DcCard as="section">
      <form onSubmit={save}>
        <SectionHead
          title="Целевые доли"
          hint="Портфель состоит из трёх частей. Пустое поле — цель не задана; сумма целей должна быть 100%."
          action={
            <span role="status">
              <StatusChip tone={sumIs100 ? "profit" : "loss"}>
                {`сумма ${tablePct(sum, Number.isInteger(sum) ? 0 : 2)}`}
              </StatusChip>
            </span>
          }
          className="border-line border-b"
        />

        <DcTable minWidth={760}>
          <thead>
            <tr>
              <Th>Актив</Th>
              <Th numeric>Цель</Th>
              <Th>Сейчас ↔ цель</Th>
              <Th numeric>Отклонение</Th>
              <Th numeric>К ребалансировке</Th>
            </tr>
          </thead>
          <tbody>
            {TARGET_CATEGORIES.map((c) => {
              const row = rows?.find((r) => r.category === c.key) ?? null;
              const target =
                parsed.find((p) => p.key === c.key)?.value ?? null;
              return (
                <Tr key={c.key}>
                  <Td className="font-medium text-[13.5px]">
                    <span className="flex items-center gap-2.5">
                      <CategoryDot category={c.key} size={7} />
                      {c.label}
                    </span>
                  </Td>

                  <Td numeric className="py-2">
                    <div className="relative ml-auto w-[92px]">
                      {/* type="text", а не "number": браузер молча съедает
                          запятую, а десятичный разделитель в приложении —
                          именно она (§4), и парсер ниже её ждёт. Спиннеры
                          всё равно скрыты, так что number ничего не давал. */}
                      <Input
                        id={`target-${c.key}`}
                        type="text"
                        inputMode="decimal"
                        value={targets[c.key] ?? ""}
                        onChange={(e) =>
                          setTargets((prev) => ({
                            ...prev,
                            [c.key]: e.target.value,
                          }))
                        }
                        placeholder="—"
                        aria-label={`Цель ${c.label}, проценты`}
                        className="pr-6 text-right font-mono text-[13px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[13px] text-text-3"
                      >
                        %
                      </span>
                    </div>
                  </Td>

                  <Td className="min-w-[180px] whitespace-normal">
                    <ShareBar
                      category={c.key}
                      actual={row?.percent ?? null}
                      target={target}
                    />
                  </Td>

                  <Deviation diff={deviation(row, target)} />

                  <Rebalance
                    row={row}
                    amount={rebalanceAmount(row, target, totalUsd)}
                    diff={deviation(row, target)}
                  />
                </Tr>
              );
            })}
          </tbody>
        </DcTable>

        <div className="flex flex-wrap items-center gap-3 border-line border-t px-card py-3.5">
          <Button type="submit" disabled={saving || !canSave}>
            {saving ? "Сохранение…" : "Сохранить цели"}
          </Button>
          {saveError ? (
            <p role="status" className="t-meta text-loss">
              {saveError}
            </p>
          ) : (
            <Disclaimer>
              {canSave
                ? "Количества к ребалансировке — расчёт, а не финансовый совет."
                : "Сумма целей должна быть 100% — иначе цели не сохраняются."}
            </Disclaimer>
          )}
        </div>
      </form>
    </DcCard>
  );
}

/**
 * Отклонение и количество к ребалансировке считаются от ЧЕРНОВИКА цели,
 * а не от сохранённой: иначе метка на полосе уже уехала, а колонки справа
 * ещё показывают старую раскладку — и строка противоречит сама себе.
 * Формулы те же, что в движке портфеля (src/lib/portfolio/portfolio.ts).
 */
function deviation(row: PortfolioRowDto | null, target: number | null): number | null {
  if (row === null || target === null) return null;
  return row.percent - target;
}

function rebalanceAmount(
  row: PortfolioRowDto | null,
  target: number | null,
  totalUsd: number | null,
): number | null {
  if (row === null || target === null || totalUsd === null) return null;
  if (row.price === null || row.price <= 0) return null;
  return ((target / 100) * totalUsd - row.amountUsd) / row.price;
}

/**
 * «Сейчас ↔ цель»: полоса факта цветом актива и белая метка цели на ней.
 * Полоса — данные, поэтому семантических цветов на ней нет (дизайн-код §2).
 */
function ShareBar({
  category,
  actual,
  target,
}: {
  category: PortfolioCategory;
  actual: number | null;
  target: number | null;
}) {
  if (actual === null) {
    return (
      <div className="flex flex-col gap-[7px]">
        <div className="h-[7px] rounded-[4px] bg-chip" />
        <span className="text-[12px] text-text-3">—</span>
      </div>
    );
  }
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  return (
    <div className="flex flex-col gap-[7px]">
      <div
        role="img"
        aria-label={
          target === null
            ? `сейчас ${tablePct(actual)}`
            : `сейчас ${tablePct(actual)}, цель ${tablePct(target)}`
        }
        className="relative h-[7px] rounded-[4px] bg-raised"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-[4px]"
          style={{
            width: `${clamp(actual)}%`,
            minWidth: actual > 0 ? 3 : 0,
            background: CATEGORY_VAR[category],
          }}
        />
        {target !== null && (
          <span
            className="-translate-x-1/2 absolute top-[-3px] h-[13px] w-[2px] rounded-[2px] bg-text-1"
            style={{ left: `${clamp(target)}%` }}
          />
        )}
      </div>
      <span className="flex items-baseline gap-2 text-[12px] text-text-3">
        <span className="font-mono text-text-2">{tablePct(actual)}</span>
        сейчас
      </span>
    </div>
  );
}

/** Отклонение от цели. Выше порога — warn: это не убыток, а расхождение. */
function Deviation({ diff }: { diff: number | null }) {
  if (diff === null) {
    return (
      <Td numeric mono muted>
        —
      </Td>
    );
  }
  const over = Math.abs(diff) > DEVIATION_THRESHOLD_PP;
  return (
    <Td numeric mono className={cn("text-[13px]", over ? "text-warn" : "text-text-2")}>
      {dcPp(diff)}
    </Td>
  );
}

/**
 * К ребалансировке: количество первым, сумма второй строкой —
 * главная метрика стратегии считается в монетах, а не в долларах.
 * У стейблов количество и есть доллары, поэтому строка одна.
 */
function Rebalance({
  row,
  amount,
  diff,
}: {
  row: PortfolioRowDto | null;
  amount: number | null;
  diff: number | null;
}) {
  if (row === null || amount === null) {
    return (
      <Td numeric mono muted>
        —
      </Td>
    );
  }
  const over = diff !== null && Math.abs(diff) > DEVIATION_THRESHOLD_PP;
  const isUsd = row.unit === "USD";
  const usd = row.price === null ? null : amount * row.price;

  return (
    <Td numeric className="py-3">
      <div className="flex flex-col items-end gap-[2px]">
        <span
          className={cn(
            "font-mono text-[13px]",
            over ? "text-warn" : "text-text-1",
          )}
        >
          {isUsd
            ? dcUsdSigned(amount)
            : `${tableSigned(amount, 4)} ${row.unit}`}
        </span>
        {!isUsd && (
          <span className="text-[12px] text-text-3">
            {usd === null ? "—" : dcUsdSigned(usd)}
          </span>
        )}
      </div>
    </Td>
  );
}

