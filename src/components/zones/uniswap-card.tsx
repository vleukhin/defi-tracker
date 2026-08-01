"use client";

import { Badge } from "@/components/ui/badge";
import type { PositionComponentDto, PositionDto } from "@/lib/api/types";
import {
  chainLabel,
  formatRelativeTime,
  tableNumber,
  tablePct,
  tableUsd,
} from "@/lib/format";
import { rangeDecision, RANGE_WAIT_HOURS } from "@/lib/positions/range-timer";
import { categoryColor, symbolCategory } from "@/lib/symbol-category";
import {
  CardFooter,
  CardHead,
  CardMetric,
  CardMetrics,
  CardSection,
  OwnershipBar,
  ProtocolCard,
  ProtocolMark,
  SplitBar,
  UnmarkedBadge,
} from "./card-parts";
import { ProfitValue } from "./position-card";
import { type MarkFn } from "./shared";

/**
 * Карточка LP-позиции Uniswap v3.
 *
 * У пула нет ставки: доход складывается из комиссий и переоценки состава,
 * поэтому вместо «ставки сейчас» на карточке несобранные комиссии — их
 * позиция накопила, но в стоимость они не входят и при выводе приходят
 * отдельно.
 *
 * Главный же вопрос к CLMM-позиции стратегия задает не про доход, а про
 * диапазон (docs/07 §5, §6): вышла ли цена и в какую сторону. От стороны
 * зависит действие — по нижней границе позиция стала волатильным активом
 * и его уводят в Growth, по верхней стала стейблами и диапазон
 * перезаливают. И в обоих случаях ждут ~48 часов, а не дергаются сразу,
 * поэтому в подвале не только факт выхода, но и сколько ждать осталось.
 *
 * Сторона определяется по составу, а не по тикам: token0/token1 в пуле
 * упорядочены по адресам, и «верхняя граница» в терминах тика означает
 * разное в зависимости от того, каким из токенов оказался стейбл. Состав
 * же однозначен: осталось в стейблах — цена базового актива выросла,
 * осталось в BTC/ETH — упала.
 */

/** Фирменный розовый Uniswap. Только заливкой — не текстом. */
const UNI_ACCENT = "#ff007a";
const UNI_ACCENT_LIGHT = "#ff6fae";

export function UniswapCard({
  position,
  busy,
  onMark,
  nowMs,
}: {
  position: PositionDto;
  busy: boolean;
  onMark: MarkFn;
  /** «Сейчас» снаружи — таймер 48 часов считается от него. */
  nowMs: number;
}) {
  const own = position.ownPrincipalUsd;
  const borrowed = position.borrowedPrincipalUsd;
  const principal = own !== null && borrowed !== null ? own + borrowed : null;

  const inRange = position.inRange !== false;
  const feesUsd = position.feesUsd;

  return (
    <ProtocolCard accent={UNI_ACCENT}>
      <CardHead
        mark={<UniswapMark />}
        name="Uniswap v3"
        subtitle={`${position.title} · ${chainLabel(position.chain)}`}
        badges={
          <>
            <UnmarkedBadge principal={principal} />
            {!inRange && <Badge variant="warning">вне диапазона</Badge>}
          </>
        }
        position={position}
        busy={busy}
        onMark={onMark}
      />

      <CardMetrics>
        <CardMetric
          label="Стоимость"
          value={
            position.valueUsd === null ? null : tableUsd(position.valueUsd)
          }
        >
          {"доход "}
          <ProfitValue position={position} className="text-xs" />
        </CardMetric>

        <CardMetric
          label="Комиссии"
          value={feesUsd === null ? null : tableUsd(feesUsd)}
          unit="не собраны"
        >
          {feesUsd === null ? (
            "комиссии не прочитаны — симуляция сбора не удалась"
          ) : (
            <>
              {"в стоимость позиции не входят"}
              {principal !== null && principal > 0 && (
                <>
                  {" · "}
                  <span className="font-mono">
                    {tablePct((feesUsd / principal) * 100, 2)}
                  </span>
                  {" к вложенному"}
                </>
              )}
            </>
          )}
        </CardMetric>
      </CardMetrics>

      <CardSection label="Состав">
        <CompositionBar components={position.components} />
      </CardSection>

      <CardSection
        label="Вложено"
        value={principal === null ? null : tableUsd(principal)}
      >
        <OwnershipBar own={own} borrowed={borrowed} accent={UNI_ACCENT} />
      </CardSection>

      <RangeFooter position={position} nowMs={nowMs} />
    </ProtocolCard>
  );
}

/**
 * Состав позиции: доли токенов пары по стоимости. Красится языком категорий
 * портфеля (ТЗ §1.3) — пропорцию вроде 60/40 из стратегии видно цветом,
 * а не только числами.
 */
function CompositionBar({
  components,
}: {
  components: PositionComponentDto[];
}) {
  const priced = components.every((c) => c.valueUsd !== null);
  const total = priced
    ? components.reduce((sum, c) => sum + (c.valueUsd ?? 0), 0)
    : 0;

  // Без цен долей нет — показываем количества, а не выдуманные проценты
  if (!priced || total <= 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {components.map((c, i) => (
          <span key={c.symbol}>
            {i > 0 && " · "}
            <span className="font-mono">{quantity(c.quantity)}</span>
            {` ${c.symbol}`}
          </span>
        ))}
        {!priced && " — цены компонентов нет, доли не считаются"}
      </p>
    );
  }

  // Вне диапазона позиция целиком в одном активе: нулевая доля второго
  // токена — не данные, а шум
  const segments = components
    .map((c) => ({
      label: c.symbol,
      value: quantity(c.quantity),
      percent: ((c.valueUsd ?? 0) / total) * 100,
      color: categoryColor(c.symbol),
    }))
    .filter((s) => s.percent > 0);

  return (
    <SplitBar
      ariaLabel={`Состав: ${segments
        .map((s) => `${s.label} ${tablePct(s.percent, 1)}`)
        .join(", ")}`}
      segments={segments}
    />
  );
}

/**
 * Диапазон и правило 48 часов. Пока позиция в диапазоне — она работает,
 * и трогать ее нечего; вышла — начинается отсчет, и действие зависит от
 * стороны выхода.
 */
function RangeFooter({
  position,
  nowMs,
}: {
  position: PositionDto;
  nowMs: number;
}) {
  if (position.inRange !== false) {
    return (
      <CardFooter
        title={position.subtitle ?? "В диапазоне"}
        badge={<Badge variant="success">в диапазоне</Badge>}
      >
        Пока цена в диапазоне, позиция собирает комиссии — по стратегии делать с
        ней нечего.
      </CardFooter>
    );
  }

  const since = position.outOfRangeSince;
  const decision = since === null ? null : rangeDecision(since, nowMs);
  const side = exitSide(position.components);
  const asset = position.components.find((c) => c.quantity > 0)?.symbol;

  return (
    <CardFooter
      title={
        since === null ? (
          "Вне диапазона"
        ) : (
          <>
            {"Вне диапазона "}
            <span className="text-foreground">
              {formatRelativeTime(since, nowMs)}
            </span>
          </>
        )
      }
      badge={
        decision && (
          <Badge
            variant={decision.ready ? "warning" : "muted"}
            className="font-mono"
          >
            {decision.ready
              ? "срок вышел"
              : `ждать ${Math.ceil(decision.hoursLeft)} ч`}
          </Badge>
        )
      }
    >
      {since === null ? (
        `Момент выхода не записан — отсчет ${RANGE_WAIT_HOURS} часов пойдет с ближайшего обновления.`
      ) : (
        <>
          {asset && side !== null && (
            <>
              {`Позиция целиком в ${asset} — цена ушла ${side === "down" ? "вниз" : "вверх"}. `}
            </>
          )}
          {decision?.ready
            ? "Срок ожидания вышел — по стратегии можно действовать: "
            : "По стратегии ждем 48 часов (в выходные — до понедельника), затем "}
          {side === "down"
            ? "закрыть позицию и увести актив — в залог под HF, в пулы BTC↔BTC / ETH↔stETH или на лендинг с наградами."
            : side === "up"
              ? "закрыть позицию, забрать стейблы и открыть новую с актуальным диапазоном."
              : "решить по позиции."}
          {decision && !decision.ready && decision.postponedToMonday && (
            <> Срок выпал на выходные — ждем понедельника.</>
          )}
        </>
      )}
    </CardFooter>
  );
}

/**
 * Сторона выхода по составу: остались стейблы — базовый актив подорожал
 * (цена ушла вверх), остались BTC/ETH — подешевел. Пара из двух стейблов
 * стороны не имеет: там расти нечему.
 */
function exitSide(components: PositionComponentDto[]): "up" | "down" | null {
  const held = components.filter((c) => c.quantity > 0);
  if (held.length !== 1) return null;
  const category = symbolCategory(held[0].symbol);
  if (category === "stable") return "up";
  if (category === "btc" || category === "eth") return "down";
  return null;
}

/** Количество токена: чем меньше число, тем больше знаков после запятой. */
function quantity(value: number): string {
  if (value >= 1000) return tableNumber(value, 0);
  if (value >= 1) return tableNumber(value, 4);
  return tableNumber(value, 6);
}

/** Знак Uniswap — стрелки обмена на фирменном розовом. */
function UniswapMark() {
  return (
    <ProtocolMark from={UNI_ACCENT} to={UNI_ACCENT_LIGHT}>
      <path
        fill="#fff"
        d="M5 8.6h9.5l-2.3-2.3 1.4-1.4 4.7 4.7-4.7 4.7-1.4-1.4 2.3-2.3H5z"
      />
      <path
        fill="#fff"
        fillOpacity="0.75"
        d="M19 17.4H9.5l2.3 2.3-1.4 1.4L5.7 16.4l4.7-4.7 1.4 1.4-2.3 2.3H19z"
      />
    </ProtocolMark>
  );
}
