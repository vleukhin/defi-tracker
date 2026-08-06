"use client";

import { TrendingDown } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Chip, StatusChip } from "@/components/dc/chip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { PositionDto } from "@/lib/api/types";
import { dcPp, dcUsd, tablePct } from "@/lib/format";
import { gmLevels, type GmLevelsView } from "@/lib/positions/gm-levels";
import { cn } from "@/lib/utils";

/**
 * Шкала уровней GM-пула (docs/07 §5–§7): где стоит цена базового актива
 * относительно точки отсчёта, какие уровни действий уже позади и какой
 * ближайший.
 *
 * Живёт в поповере по той же причине, что и разметка: читают её в момент
 * решения, а не каждый день, и семь строк со списком действий отняли бы
 * у карточки место, отведённое числам.
 *
 * Шкала идёт сверху вниз по цене: ориентир фиксации на росте (+50%, §6),
 * сама точка отсчёта, затем уровни падения. Маркер «сейчас» встаёт между
 * строками ровно там, где стоит цена, — «где мы находимся» показывается
 * положением, а не подписью где-то сбоку.
 *
 * Чего шкала не знает: касались ли уровня раньше. Приложение видит только
 * текущую цену, поэтому «пройден» здесь значит «цена сейчас не выше», и
 * сноска внизу говорит об этом прямо.
 */
export function GmLevelsPopover({ position }: { position: PositionDto }) {
  const view = gmLevels(position);
  const set = view.entryPriceUsd !== null;
  const reached = view.reachedCount !== null && view.reachedCount > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Уровни падения: ${position.title}`}
          title="Уровни падения от точки отсчёта"
          className={cn(
            // Тот же контрол, что и кнопка разметки (дизайн-код §5): в шапке
            // карточки они стоят рядом и обязаны читаться одинаково
            "flex h-[30px] shrink-0 items-center gap-1.5 rounded-control border border-line-card px-2 outline-none transition-colors duration-120 ease-out pointer-coarse:h-11 pointer-coarse:px-3 hover:border-line-hover hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50",
            reached ? "text-warn" : "text-text-3",
          )}
        >
          <TrendingDown className="size-3.5" />
          {view.changePercent !== null && (
            <span className="font-mono text-[12px] tabular-nums">
              {dcPp(view.changePercent, 1)}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[352px]">
        <div className="flex flex-col gap-3">
          <div>
            <p className="t-h3">Уровни падения</p>
            <p className="t-meta truncate text-text-3">
              {position.title}
              {view.marketSymbol ? ` · цена ${view.marketSymbol}` : ""}
            </p>
          </div>

          {!set ? (
            <NoEntryPrice />
          ) : (
            <>
              <Now view={view} />
              <Scale view={view} />
              <Footer view={view} />
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Без точки отсчёта шкалы нет — и подсказано, где её задать. */
function NoEntryPrice() {
  return (
    <p className="text-[12.5px] text-text-2">
      Точка отсчёта не задана, и уровни считать не от чего. Цена входа
      указывается в разметке позиции — кнопкой рядом.
    </p>
  );
}

/** Две величины, из которых считается всё остальное. */
function Now({ view }: { view: GmLevelsView }) {
  return (
    <div className="flex items-stretch gap-px overflow-hidden rounded-block bg-line">
      <Cell label="Точка отсчёта" value={dcUsd(view.entryPriceUsd ?? 0)} />
      <Cell
        label="Цена сейчас"
        value={
          view.currentPriceUsd === null ? null : dcUsd(view.currentPriceUsd)
        }
        note={
          view.changePercent === null ? undefined : (
            <span
              className={cn(
                view.changePercent < 0 ? "text-loss" : "text-profit",
              )}
            >
              {dcPp(view.changePercent, 1)}
            </span>
          )
        }
      />
    </div>
  );
}

function Cell({
  label,
  value,
  note,
}: {
  label: string;
  value: string | null;
  note?: ReactNode;
}) {
  return (
    <div className="flex-1 bg-sunken px-3 py-2.5">
      <span className="t-label">{label}</span>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-[13.5px] tabular-nums">
          {value ?? <span className="text-text-3">—</span>}
        </span>
        {note && <span className="text-[12px]">{note}</span>}
      </p>
    </div>
  );
}

/**
 * Шкала: строки идут по убыванию цены, маркер «сейчас» вставляется в свой
 * промежуток. Порядок строк — это и есть ответ на вопрос «где мы».
 */
function Scale({ view }: { view: GmLevelsView }) {
  const entry = view.entryPriceUsd ?? 0;
  const rows: ScaleRow[] = [
    ...(view.growth
      ? [
          {
            key: "growth",
            priceUsd: view.growth.priceUsd,
            title: dcPp(view.growth.percent, 0),
            note: "ориентир первой фиксации: часть GM продают",
            reached: view.growth.reached,
            tone: "profit" as const,
          },
        ]
      : []),
    {
      key: "entry",
      priceUsd: entry,
      title: "вход",
      note: "точка отсчёта — цена базового актива на входе",
      reached: null,
      tone: "entry" as const,
    },
    ...view.levels.map((l) => ({
      key: `d${l.dropPercent}`,
      priceUsd: l.priceUsd,
      title: dcPp(-l.dropPercent, 0),
      note: l.action,
      stability: l.stabilityAction,
      reached: l.reached,
      next: view.nextLevel?.dropPercent === l.dropPercent,
      tone: "drop" as const,
    })),
  ];

  // Маркер встаёт перед первой строкой, цену которой мы уже прошли вниз;
  // если цена ниже всей шкалы — в самый низ, если цены нет — не встаёт вовсе
  const price = view.currentPriceUsd;
  const above = price === null ? -1 : rows.findIndex((r) => price > r.priceUsd);
  const markerAt = price === null ? -1 : above === -1 ? rows.length : above;

  return (
    <ol className="flex flex-col">
      {rows.map((row, index) => (
        <Fragment key={row.key}>
          {index === markerAt && <NowMarker view={view} />}
          <ScaleItem row={row} />
        </Fragment>
      ))}
      {markerAt === rows.length && <NowMarker view={view} />}
    </ol>
  );
}

interface ScaleRow {
  key: string;
  priceUsd: number;
  title: string;
  note: string;
  stability?: string | null;
  reached: boolean | null;
  next?: boolean;
  tone: "profit" | "entry" | "drop";
}

function ScaleItem({ row }: { row: ScaleRow }) {
  const passed = row.reached === true;
  return (
    <li className="flex gap-2.5 py-1.5">
      <span
        aria-hidden
        className={cn(
          "mt-[7px] size-[7px] shrink-0 rounded-full",
          passed && row.tone === "drop" && "bg-warn",
          passed && row.tone === "profit" && "bg-profit",
          !passed && row.tone === "entry" && "bg-text-3",
          !passed && row.tone !== "entry" && "bg-line-strong",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                "font-mono text-[13px] tabular-nums",
                passed ? "text-text-1" : "text-text-2",
              )}
            >
              {row.title}
            </span>
            {passed && row.tone === "drop" && (
              <StatusChip tone="warn">пройден</StatusChip>
            )}
            {passed && row.tone === "profit" && (
              <StatusChip tone="profit">достигнут</StatusChip>
            )}
            {row.next && <Chip>ближайший</Chip>}
          </span>
          <span className="font-mono text-[12px] tabular-nums text-text-3">
            {dcUsd(row.priceUsd)}
          </span>
        </div>
        <p className="text-[12px] text-text-3">{row.note}</p>
        {row.stability && (
          <p className="text-[12px] text-text-3">
            Stability: {row.stability}
          </p>
        )}
      </div>
    </li>
  );
}

/** «Сейчас» — линия между строками шкалы, а не ещё один её уровень. */
function NowMarker({ view }: { view: GmLevelsView }) {
  return (
    <li className="flex items-center gap-2.5 py-1">
      <span
        aria-hidden
        className="h-[15px] w-[2px] shrink-0 rounded-[1px] bg-primary"
      />
      <span className="flex flex-1 items-baseline justify-between gap-2 text-[12px]">
        <span className="font-medium text-primary">
          сейчас
          {view.changePercent === null
            ? ""
            : ` · ${dcPp(view.changePercent, 1)}`}
        </span>
        <span className="font-mono tabular-nums text-text-2">
          {view.currentPriceUsd === null ? "—" : dcUsd(view.currentPriceUsd)}
        </span>
      </span>
    </li>
  );
}

function Footer({ view }: { view: GmLevelsView }) {
  return (
    <div className="flex flex-col gap-1.5 border-line border-t pt-2.5">
      <p className="text-[12.5px] text-text-2">{verdict(view)}</p>
      <p className="text-[12px] text-text-3">
        Пройденным уровень считается по текущей цене: заход ниже с отскоком
        приложение не помнит. Перед действием по уровню цена должна
        закрепиться — правило 48 часов.
      </p>
    </div>
  );
}

/** Утверждение, а не инструкция (дизайн-код §7). */
function verdict(view: GmLevelsView): string {
  if (view.currentPriceUsd === null) {
    return "Цена базового актива не прочитана — где стоит цена относительно уровней, не видно.";
  }
  if (view.nextLevel === null) {
    return "Пройдены все уровни падения: глубже шкала действий стратегии не идёт.";
  }
  // «Осталось упасть» — величина от сегодняшней цены, поэтому обычный
  // процент, а не отклонение со знаком: знак уже сказан словом «упасть».
  // Действие уровня здесь не повторяется — оно стоит строкой шкалы
  const next = `ближайший ${dcPp(-view.nextLevel.dropPercent, 0)}, до него цене осталось упасть на ${tablePct(view.toNextPercent ?? 0, 1)}.`;
  return view.lastReached === null
    ? `Пройденных уровней нет: ${next}`
    : `Пройден уровень ${dcPp(-view.lastReached.dropPercent, 0)}, ${next}`;
}
