"use client";

import { Children, Fragment, type ReactNode } from "react";
import type { Segment } from "@/components/dc/bar";
import { DcCard } from "@/components/dc/card";
import { Chip, ZoneChip } from "@/components/dc/chip";
import { Delta, MetricGrid } from "@/components/dc/metrics";
import { MetaDot, ProtocolTile } from "@/components/dc/page-header";
import { protocolBrand } from "@/components/dc/protocols";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  PositionComponentDto,
  PositionDto,
  StrategyZone,
} from "@/lib/api/types";
import {
  dcDelta,
  dcUsd,
  dcUsdSigned,
  tableNumber,
  tablePct,
} from "@/lib/format";
import { categoryColor } from "@/lib/symbol-category";
import { cn } from "@/lib/utils";

/**
 * Каркас карточки позиции (дизайн-код §5) — четыре полосы сверху вниз:
 * шапка → метрики → визуалы → вывод.
 *
 * Типы позиций отличаются ТОЛЬКО наполнением: у LP диапазон, у депозита
 * ставка, у займа запас прочности. Каркас один, и держит его этот файл —
 * иначе каждый следующий протокол изобретает свою вёрстку, и одинаковые
 * по смыслу числа оказываются на разной высоте в соседних карточках.
 *
 * Плотность задают волосяные линии и смена фона, а не отступы: полосы
 * разделены `border-t border-line`, ячейки внутри полосы — `gap-px` на
 * фоне `bg-line`.
 */

/**
 * Поверхность карточки. Список позиций — <ul>, поэтому по умолчанию <li>;
 * карточка займа живёт вне списка и получает `as="article"`.
 */
export function PositionShell({
  children,
  className,
  as = "li",
}: {
  children: ReactNode;
  className?: string;
  as?: "li" | "article";
}) {
  return (
    // Провайдер тултипов — на самой карточке: «?» у метрик обязан работать
    // в любом окружении, а вложенные провайдеры radix друг другу не мешают
    <TooltipProvider>
      <DcCard as={as} hoverable className={cn("flex flex-col", className)}>
        {children}
      </DcCard>
    </TooltipProvider>
  );
}

/**
 * Полоса 1 — шапка: плитка протокола 34px → название + чип зоны + чип типа,
 * мета-строка → статус и меню справа.
 */
export function CardHead({
  protocol,
  name,
  zone,
  kind,
  meta,
  status,
  menu,
}: {
  /** Ключ протокола: из него берутся аббревиатура плитки и фирменный цвет. */
  protocol: string;
  name?: string;
  zone: StrategyZone;
  /** Нейтральный чип типа рядом с зоной: «займ», «не размечено». */
  kind?: ReactNode;
  /** Мета-строка: части разделяются точками автоматически. */
  meta: ReactNode[];
  /** Чип статуса риска справа — только profit/warn/loss. */
  status?: ReactNode;
  /** Кнопка меню 30px; у позиций это разметка (MarkPopover). */
  menu?: ReactNode;
}) {
  const brand = protocolBrand(protocol);
  return (
    <div className="flex items-center gap-[13px] px-card pt-4 pb-3.5">
      <ProtocolTile abbr={brand.abbr} color={brand.color} />
      <div className="flex min-w-0 flex-col gap-[3px]">
        <div className="flex flex-wrap items-center gap-x-[9px] gap-y-1">
          <span className="t-h3 truncate">{name ?? brand.label}</span>
          <ZoneChip zone={zone} />
          {kind}
        </div>
        <MetaRow items={meta} />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {status}
        {menu}
      </div>
    </div>
  );
}

/** Мета-строка шапки: 12,5px --text-3, разделители — точки --text-4. */
export function MetaRow({ items }: { items: ReactNode[] }) {
  const shown = items.filter((item) => item !== null && item !== undefined && item !== false);
  if (shown.length === 0) return null;
  return (
    <div className="t-meta flex flex-wrap items-center gap-x-2 text-text-3">
      {/* Части меты — готовые узлы без своих ключей; порядок фиксирован
          разметкой карточки, поэтому индекс тут стабилен */}
      {shown.map((item, index) => (
        <Fragment key={`meta-${index}`}>
          {index > 0 && <MetaDot />}
          <span>{item}</span>
        </Fragment>
      ))}
    </div>
  );
}

/** Точное количество токена в мета-строке — единственный Mono мельче 24px. */
export function MetaMono({ children }: { children: ReactNode }) {
  return <span className="font-mono">{children}</span>;
}

/** Полоса 2 — метрики: четыре равные ячейки, на 1280 и ниже складываются в две. */
export function MetricRow({ children }: { children: ReactNode }) {
  return (
    <MetricGrid columns={4} className="border-line border-t">
      {children}
    </MetricGrid>
  );
}

/**
 * Полоса 3 — визуалы на --bg-sunken. Один блок занимает ряд целиком, два
 * встают рядом: пустая половина показала бы полосу фона-разделителя.
 */
export function VisualRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-px border-line border-t bg-line",
        Children.count(children) > 1 && "sm:grid-cols-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Подпись над полосой, у которой своей подписи нет (RangeBar, SafetyBar):
 * label слева, справка справа. Тот же фон, что у полосы, — блок читается
 * как одно целое.
 */
export function VisualHead({
  label,
  note,
  className,
}: {
  label: string;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-sunken px-card pt-3.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">{label}</span>
        {note != null && (
          <span className="text-[12px] text-text-3">{note}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Блок визуалов без полосы: та же геометрия, что у BarBlock, но вместо
 * полосы — строка о том, почему полосы нет. Пустое место на её месте
 * читалось бы как «данных ноль», а данных просто не хватает.
 */
export function PlainBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-sunken px-card py-3.5">
      <span className="t-label">{label}</span>
      <p className="mt-2.5 text-[12.5px] text-text-3">{children}</p>
    </div>
  );
}

/** Чип «не размечено»: нейтральный — это тип записи, а не риск. */
export function UnmarkedChip({ position }: { position: PositionDto }) {
  if (!isUnmarked(position)) return null;
  return <Chip>не размечено</Chip>;
}

export function isUnmarked(position: PositionDto): boolean {
  return (
    position.ownPrincipalUsd === null || position.borrowedPrincipalUsd === null
  );
}

/** Вложенное известно, только когда размечены ОБЕ части. */
export function principalOf(position: PositionDto): number | null {
  const own = position.ownPrincipalUsd;
  const borrowed = position.borrowedPrincipalUsd;
  return own !== null && borrowed !== null ? own + borrowed : null;
}

/**
 * Третий уровень ячейки «Стоимость»: доход суммой и процентом.
 * Знак несут и цвет, и сам знак — цветом одним обходиться нельзя.
 */
export function profitDelta(position: PositionDto): ReactNode {
  const { profitUsd, profitPct } = position;
  if (profitUsd === null) return "доход не считается — нет разметки";
  const tone = profitUsd > 0 ? "profit" : profitUsd < 0 ? "loss" : "neutral";
  return (
    <Delta tone={tone}>
      {profitPct === null
        ? dcUsdSigned(profitUsd)
        : dcDelta(profitUsd, profitPct)}
    </Delta>
  );
}

/** Третий уровень ячейки «Вложено»: чьи это деньги, в процентах. */
export function ownershipDelta(position: PositionDto): ReactNode {
  const own = position.ownPrincipalUsd;
  const borrowed = position.borrowedPrincipalUsd;
  if (own === null || borrowed === null) return "не размечено";
  const principal = own + borrowed;
  if (principal === 0) return "размечено как пустая";
  const ownPct = (own / principal) * 100;
  // Доля в ноль — не данные: «заёмные 0%» повторяет «свои 100%» и только
  // удлиняет строку
  if (own === 0) return `заёмные ${tablePct(100, 0)}`;
  if (borrowed === 0) return `свои ${tablePct(ownPct, 0)}`;
  return `свои ${tablePct(ownPct, 0)} · заёмные ${tablePct(100 - ownPct, 0)}`;
}

/**
 * Сегменты полосы «Чьи деньги». Цвета — только --money-own /
 * --money-borrowed: фирменный цвет протокола тут значил бы «чьи», хотя
 * говорит «где».
 */
export function ownershipSegments(position: PositionDto): Segment[] | null {
  const own = position.ownPrincipalUsd;
  const borrowed = position.borrowedPrincipalUsd;
  if (own === null || borrowed === null) return null;
  const principal = own + borrowed;
  if (principal <= 0) return null;
  return [
    {
      key: "own",
      percent: (own / principal) * 100,
      color: "var(--money-own)",
      label: "свои",
      value: dcUsd(own),
    },
    {
      key: "borrowed",
      percent: (borrowed / principal) * 100,
      color: "var(--money-borrowed)",
      label: "заёмные",
      value: dcUsd(borrowed),
    },
    // Нулевая доля — не данные: пустой сегмент и «заёмные $0» в легенде
    // говорят то же, что уже сказала соседняя доля
  ].filter((s) => s.percent > 0);
}

/**
 * Сегменты полосы «Состав»: доли токенов по стоимости, цветами категорий
 * портфеля. Без цен долей нет — возвращается null, и карточка показывает
 * количества, а не выдуманные проценты.
 *
 * Нулевые доли отбрасываются: вне диапазона позиция целиком в одном активе,
 * и второй сегмент был бы шумом.
 */
export function componentSegments(
  components: PositionComponentDto[],
  { withSide = false }: { withSide?: boolean } = {},
): Segment[] | null {
  const priced = components.every((c) => c.valueUsd !== null);
  if (!priced) return null;
  const total = components.reduce((sum, c) => sum + (c.valueUsd ?? 0), 0);
  if (total <= 0) return null;

  return components
    .map((c) => ({
      key: `${c.symbol}-${c.side ?? "flat"}`,
      percent: ((c.valueUsd ?? 0) / total) * 100,
      color: categoryColor(c.symbol),
      label:
        withSide && c.side !== null ? `${c.symbol} · ${c.side}` : c.symbol,
      value: tokenQuantity(c.quantity),
    }))
    .filter((s) => s.percent > 0);
}

/** Справка над полосой состава: «30 / 70» — пропорция без единиц. */
export function splitNote(segments: Segment[]): string {
  return segments.map((s) => tableNumber(s.percent, 0)).join(" / ");
}

/** Количества компонентов строкой — когда цен нет и долей не посчитать. */
export function componentQuantities(
  components: PositionComponentDto[],
): ReactNode {
  return components.map((c, index) => (
    <Fragment key={`${c.symbol}-${c.side ?? "flat"}`}>
      {index > 0 && " · "}
      <MetaMono>{tokenQuantity(c.quantity)}</MetaMono>
      {` ${c.symbol}`}
    </Fragment>
  ));
}

/**
 * Количество токена в подписи: чем меньше число, тем больше знаков, но
 * хвостовые нули отбрасываются — «800,2000 USDC» читается хуже, чем
 * «800,2», а точности не добавляет.
 */
export function tokenQuantity(value: number): string {
  const decimals = value >= 1000 ? 0 : value >= 1 ? 4 : 6;
  const trimmed = tableNumber(value, decimals)
    .replace(/(,\d*?)0+$/, "$1")
    .replace(/,$/, "");
  // Пыль, округлившаяся до нуля: ноль сказал бы «ничего нет», а это не так
  return value > 0 && Number(trimmed.replace(/\s/g, "").replace(",", ".")) === 0
    ? "<0,000001"
    : trimmed;
}

/** Цена в человеческом виде; null = границы нет (позиция на весь диапазон). */
export function priceLabel(price: number | null): string {
  if (price === null) return "без границы";
  // До десяти тысяч копейки различимы и нужны: диапазон бывает узким
  if (price >= 10_000) return tableNumber(price, 0);
  if (price >= 1) return tableNumber(price, 2);
  return tableNumber(price, 6);
}
