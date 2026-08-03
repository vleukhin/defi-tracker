"use client";

import { useState } from "react";
import { toast } from "sonner";
import { HelpTip } from "@/components/dc/help-tip";
import { Input } from "@/components/ui/input";
import { dcUsd, tableNumber, tablePct } from "@/lib/format";
import { ApiError, apiFetch } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { ltvRebalance } from "./risk";

/**
 * Целевой LTV и выравнивание плеча к нему (docs/07 §10.3).
 *
 * Стратегия держит рабочую точку по LTV, а не по HF: HF отвечает «далеко ли
 * ликвидация», LTV — «сколько плеча сейчас взято». Поэтому цель задаётся
 * здесь, рядом с самим отношением, а не в общих настройках: правят её,
 * глядя на текущее плечо.
 *
 * Ответ — одно число: насколько изменить долг. Залог при этом неизменен,
 * потому что заёмные приходят стейблами и в залог не попадают.
 */

const HINT =
  "Рабочий уровень плеча по стратегии: долг, делённый на залог. Показывает, на сколько изменить долг, чтобы вернуться к нему. Не порог ликвидации — тот задаёт протокол.";

/** Целевой LTV из строки с запятой; null = не число или вне границ. */
function parseTarget(raw: string): number | null {
  const value = Number.parseFloat(raw.trim().replace(",", "."));
  if (!Number.isFinite(value) || value <= 0 || value > 90) return null;
  return value;
}

export function LtvTarget({
  collateralUsd,
  debtUsd,
  targetLtvPct,
  liquidationLtvPercent,
  onSaved,
}: {
  collateralUsd: number | null;
  debtUsd: number | null;
  targetLtvPct: number;
  /** Порог ликвидации: цель выше него — заявка на ликвидацию. */
  liquidationLtvPercent: number | null;
  onSaved: (targetLtvPct: number) => void;
}) {
  const [draft, setDraft] = useState(() => tableNumber(targetLtvPct, 2));
  const [saving, setSaving] = useState(false);

  // Значение пришло извне (ответ /api/settings, своя же запись) — подхватываем.
  // Правка состояния прямо в рендере, а не в эффекте: эффект дал бы лишний
  // проход с устаревшим полем, и линтер справедливо на это ругается
  const [syncedTo, setSyncedTo] = useState(targetLtvPct);
  if (syncedTo !== targetLtvPct && !saving) {
    setSyncedTo(targetLtvPct);
    setDraft(tableNumber(targetLtvPct, 2));
  }

  const parsed = parseTarget(draft);
  const invalid = parsed === null;
  // Пока в поле мусор, считаем по сохранённому: строка вывода не должна
  // мигать «—» на каждом промежуточном нажатии
  const effective = parsed ?? targetLtvPct;
  const plan = ltvRebalance(collateralUsd, debtUsd, effective);
  const aboveLiquidation =
    liquidationLtvPercent !== null && effective >= liquidationLtvPercent;

  async function save() {
    if (parsed === null || parsed === targetLtvPct) {
      if (parsed === null) setDraft(tableNumber(targetLtvPct, 2));
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ targetLtvPct: parsed }),
      });
      onSaved(parsed);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Не удалось сохранить цель",
      );
      setDraft(tableNumber(targetLtvPct, 2));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-line border-t bg-sunken px-card py-3.5">
      <div className="flex items-center gap-2.5">
        <span className="t-label">Целевой LTV</span>
        <HelpTip>{HINT}</HelpTip>
        <div className="relative w-[86px]">
          <Input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setDraft(tableNumber(targetLtvPct, 2));
            }}
            disabled={saving}
            aria-label="Целевой LTV, проценты"
            aria-invalid={invalid || undefined}
            className="h-[30px] pr-6 text-right font-mono text-[13px]"
          />
          <span
            aria-hidden
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2.5 text-[12px] text-text-3"
          >
            %
          </span>
        </div>
      </div>

      <div className="min-w-0 text-right">
        {plan === null ? (
          <p className="t-meta text-text-3">
            Без залога выравнивать нечего — LTV не определён.
          </p>
        ) : (
          <>
            <p
              className={cn(
                "t-metric-sm",
                plan.action === "on-target" && "text-text-2",
              )}
            >
              {plan.action === "on-target"
                ? "на цели"
                : `${plan.action === "borrow" ? "взять ещё" : "погасить"} ${dcUsd(Math.abs(plan.deltaUsd))}`}
            </p>
            <p className="t-meta mt-1 text-text-3">
              долг станет {dcUsd(plan.targetDebtUsd)} при LTV{" "}
              {tablePct(effective, 2)}
            </p>
          </>
        )}
      </div>

      {invalid && (
        <p role="alert" className="t-meta w-full text-loss">
          Целевой LTV — число от 0 до 90.
        </p>
      )}
      {!invalid && aboveLiquidation && (
        <p role="alert" className="t-meta w-full text-warn">
          Цель не ниже порога ликвидации{" "}
          {tablePct(liquidationLtvPercent ?? 0, 1)} — на этом уровне позицию
          закроют принудительно.
        </p>
      )}
    </div>
  );
}
