"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { zoneTextColor } from "@/components/dc/chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpTip } from "@/components/dc/help-tip";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { PositionDto, StrategyZone } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  ZONE_ACCENT,
  ZONE_OPTIONS,
  zoneTint,
  type MarkFn,
  type MarkPatch,
} from "./shared";

/**
 * Разметка позиции: зона стратегии и вложенные суммы.
 *
 * Живёт в поповере, а не в карточке: правят её редко — при заведении позиции
 * и при выводе, — а читают каждый день. Форма из четырёх контролов в каждой
 * строке отнимала место у чисел, ради которых на экран и заходят.
 *
 * Триггер — кнопка меню карточки 30px с обводкой --line-card (дизайн-код §5,
 * шапка карточки позиции): это единственный элемент управления в шапке,
 * и выглядеть он должен как контрол, а не как ещё один чип.
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
        <button
          type="button"
          disabled={busy}
          aria-label={`Разметка позиции: ${position.title}`}
          title="Разметка позиции"
          // На тач-ширинах 30px мало (§6): рядом стоит кнопка уровней с
          // просветом 6px, и промах открывал не тот поповер
          className="grid size-[30px] shrink-0 place-items-center rounded-control border border-line-card text-text-3 outline-none transition-colors duration-120 ease-out pointer-coarse:size-11 hover:border-line-hover hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <SlidersHorizontal className="size-3.5" />
        </button>
      </PopoverTrigger>
      {/* Содержимое размонтируется при закрытии — черновик каждый раз
          начинается с сохранённых значений, а не с прошлой правки */}
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
  const [entryPrice, setEntryPrice] = useState(draftOf(position.entryPriceUsd));

  // Точка отсчёта осмысленна там, где стратегия привязывает действия
  // к уровням падения, — это GM-пулы (docs/07 §5). У депозита и у CLMM
  // свои события: ставка и выход из диапазона
  const withEntryPrice = position.protocol === "gmx_v2";
  const market = position.components.find((c) => c.side === "long")?.symbol;

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
        "Вложено заёмных",
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

    if (withEntryPrice) {
      // Цена, в отличие от сумм, не бывает нулевой: от нуля падение
      // не считается — это не «ноль долларов», а деление на ноль
      const parsed = parsePrice(entryPrice);
      if (parsed === undefined) {
        toast.error("Цена входа: должна быть числом больше нуля");
        return;
      }
      if (parsed !== position.entryPriceUsd) patch.entryPriceUsd = parsed;
    }

    // Ничего не тронули — незачем и запрос: API такую правку отклоняет
    if (Object.keys(patch).length === 0) {
      onDone();
      return;
    }
    if (await onMark(position, patch)) onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <p className="t-h3">Разметка позиции</p>
        <p className="t-meta truncate text-text-3">{position.title}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="t-label" id={`zone-${position.id}`}>
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
              // на карточке позиции зона узнаётся по нему же
              style={
                zone === o.value
                  ? {
                      background: zoneTint(o.value),
                      boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${ZONE_ACCENT[o.value]} 40%, transparent)`,
                      color: zoneTextColor(o.value),
                    }
                  : undefined
              }
              className={cn(
                // Единственный способ переназначить зону позиции — 32px
                // под палец мало (§6)
                "flex h-8 items-center justify-center rounded-control px-2 text-[12.5px] outline-none transition-colors duration-120 ease-out pointer-coarse:h-11 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                zone === o.value
                  ? "font-medium"
                  : "text-text-3 hover:bg-raised hover:text-text-1",
              )}
            >
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
        label="Вложено заёмных, $"
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

      {withEntryPrice && (
        <AmountField
          id={`entry-${position.id}`}
          label={`Цена входа${market ? `, $ за ${market}` : ", $"}`}
          value={entryPrice}
          onChange={setEntryPrice}
          hint="Точка отсчёта: цена базового актива на момент входа в пул. От неё считаются уровни −7 / −15 / −30 / −50 / −70. После продажи GM на уровне и повторной покупки точка переносится сюда же"
        />
      )}

      <p className="text-[12px] text-text-3">
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
    <div className="flex flex-col gap-1.5">
      {/* Пояснение живёт в «?», а не в title: на тач-экране title
          не показывается никогда, а под ним здесь лежит объяснение точки
          отсчёта — величины, от которой стратегия считает все уровни */}
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id} className="t-label">
          {label}
        </Label>
        {hint && <HelpTip>{hint}</HelpTip>}
      </div>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="не указано"
        className="font-mono"
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

/**
 * То же для цены, но ноль тут не значение, а ошибка: точка отсчёта в ноль
 * не задаёт шкалу уровней, а обнуляет её. Пустое поле по-прежнему null —
 * «точка отсчёта не задана».
 */
function parsePrice(draft: string): number | null | undefined {
  const parsed = parseAmount(draft);
  if (parsed === 0) return undefined;
  return parsed;
}
