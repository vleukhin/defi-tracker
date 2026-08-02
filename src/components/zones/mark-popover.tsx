"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { PositionDto, StrategyZone } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  LABEL,
  ZONE_ACCENT,
  ZONE_OPTIONS,
  zoneTint,
  type MarkFn,
  type MarkPatch,
} from "./shared";

/**
 * Разметка позиции: зона стратегии и вложенные суммы.
 *
 * Живет в поповере, а не в карточке: правят ее редко — при заведении позиции
 * и при выводе, — а читают каждый день. Форма из четырех контролов в каждой
 * строке отнимала место у чисел, ради которых на экран и заходят.
 */
export function MarkPopover({
  position,
  busy,
  onMark,
}: {
  position: PositionDto;
  busy: boolean;
  onMark: MarkFn;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={`Разметка позиции: ${position.title}`}
          title="Разметка позиции"
        >
          <SlidersHorizontal />
        </Button>
      </PopoverTrigger>
      {/* Содержимое размонтируется при закрытии — черновик каждый раз
          начинается с сохраненных значений, а не с прошлой правки */}
      <PopoverContent align="end" className="w-80">
        <MarkForm
          position={position}
          busy={busy}
          onMark={onMark}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function MarkForm({
  position,
  busy,
  onMark,
  onDone,
}: {
  position: PositionDto;
  busy: boolean;
  onMark: MarkFn;
  onDone: () => void;
}) {
  const [zone, setZone] = useState<StrategyZone>(position.zone);
  const [own, setOwn] = useState(draftOf(position.ownPrincipalUsd));
  const [borrowed, setBorrowed] = useState(
    draftOf(position.borrowedPrincipalUsd),
  );
  const [withdrawn, setWithdrawn] = useState(draftOf(position.withdrawnUsd));

  /** Одним запросом: разметка правится целиком, а не по полю за раз. */
  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const patch: MarkPatch = {};
    if (zone !== position.zone) patch.zone = zone;

    const fields = [
      ["ownPrincipalUsd", own, position.ownPrincipalUsd, "Вложено своих"],
      [
        "borrowedPrincipalUsd",
        borrowed,
        position.borrowedPrincipalUsd,
        "Вложено заемных",
      ],
      ["withdrawnUsd", withdrawn, position.withdrawnUsd, "Выведено"],
    ] as const;

    for (const [key, draft, saved, label] of fields) {
      const parsed = parseAmount(draft);
      if (parsed === undefined) {
        toast.error(`${label}: сумма должна быть неотрицательным числом`);
        return;
      }
      if (parsed !== saved) patch[key] = parsed;
    }

    // Ничего не тронули — незачем и запрос: API такую правку отклоняет
    if (Object.keys(patch).length === 0) {
      onDone();
      return;
    }
    if (await onMark(position, patch)) onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <p className="text-sm font-medium">Разметка позиции</p>
        <p className="truncate text-xs text-muted-foreground">
          {position.title}
        </p>
      </div>

      <div className="space-y-1">
        <span className={cn(LABEL, "block")} id={`zone-${position.id}`}>
          Зона
        </span>
        <div
          role="group"
          aria-labelledby={`zone-${position.id}`}
          className="grid grid-cols-3 gap-1"
        >
          {ZONE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={busy}
              onClick={() => setZone(o.value)}
              aria-pressed={zone === o.value}
              // Выбранная зона подсвечена своим цветом, а не общим accent:
              // на карточке позиции зона узнается по нему же
              style={
                zone === o.value
                  ? {
                      background: zoneTint(o.value, 14),
                      boxShadow: `inset 0 0 0 1px ${ZONE_ACCENT[o.value]}`,
                    }
                  : undefined
              }
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs outline-none transition-colors duration-120 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                zone === o.value
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: ZONE_ACCENT[o.value] }}
              />
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <AmountField
        id={`own-${position.id}`}
        label="Вложено своих, $"
        value={own}
        onChange={setOwn}
      />
      <AmountField
        id={`brw-${position.id}`}
        label="Вложено заемных, $"
        value={borrowed}
        onChange={setBorrowed}
      />
      <AmountField
        id={`out-${position.id}`}
        label="Выведено, $"
        value={withdrawn}
        onChange={setWithdrawn}
        hint="Стоимость того, что забрали из позиции: BTC/ETH с продажи GM, ушедшие в залог"
      />

      <p className="text-xs text-muted-foreground">
        Пустое поле — «не размечено», и это не ноль: ноль означал бы «вложено
        ничего» и объявил бы доходом всю стоимость.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}

function AmountField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className={LABEL} title={hint}>
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="не указано"
        className="h-8 font-mono"
      />
    </div>
  );
}

function draftOf(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * Черновик поля в число: null — «снять разметку», undefined — не число.
 * Пустое поле и ноль различаются намеренно (см. подпись под формой).
 */
function parseAmount(draft: string): number | null | undefined {
  const raw = draft.trim().replace(/\s/g, "").replace(",", ".");
  if (raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}
