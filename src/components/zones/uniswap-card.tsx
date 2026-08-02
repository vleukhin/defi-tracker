"use client";

import { Badge } from "@/components/ui/badge";
import type {
  PositionComponentDto,
  PositionDto,
  PositionRangeDto,
} from "@/lib/api/types";
import {
  chainLabel,
  formatRelativeTime,
  tableNumber,
  tablePct,
  tablePctSigned,
  tableUsd,
} from "@/lib/format";
import { rangeDecision, RANGE_WAIT_HOURS } from "@/lib/positions/range-timer";
import { categoryColor, symbolCategory } from "@/lib/symbol-category";
import {
  CardBars,
  CardFooter,
  CardHead,
  CardMetric,
  CardMetrics,
  CardSection,
  OwnershipBar,
  ProtocolCard,
  ProtocolMark,
  SplitBar,
  tokenQuantity,
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

      <CardBars>
        <CardSection label="Состав">
          <CompositionBar components={position.components} />
        </CardSection>

        <CardSection
          label="Вложено"
          value={principal === null ? null : tableUsd(principal)}
        >
          <OwnershipBar own={own} borrowed={borrowed} accent={UNI_ACCENT} />
        </CardSection>
      </CardBars>

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
            <span className="font-mono">{tokenQuantity(c.quantity)}</span>
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
      value: tokenQuantity(c.quantity),
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
 * Диапазон: где цена относительно границ и что с этим делать.
 *
 * Полоса отвечает на вопрос одним взглядом — линия внутри полосы значит
 * «позиция работает», у края «вот-вот выйдет», за полосой «вышла». Числа
 * рядом: обе границы, текущая цена и расстояние до ближайшей границы.
 *
 * Правило 48 часов (docs/07 §5–§7) живет тут же: вышедшая позиция сама
 * по себе не повод действовать, повод — вышедший срок ожидания.
 */
function RangeFooter({
  position,
  nowMs,
}: {
  position: PositionDto;
  nowMs: number;
}) {
  const range = position.range;
  const outOfRange = position.inRange === false;
  const since = position.outOfRangeSince;
  const decision = since === null ? null : rangeDecision(since, nowMs);
  const side = exitSide(position.components);
  const asset = position.components.find((c) => c.quantity > 0)?.symbol;

  return (
    <CardFooter
      title={
        range === null
          ? (position.subtitle ?? "Диапазон")
          : `Диапазон · ${range.quoteSymbol} за ${range.baseSymbol}`
      }
      badge={
        outOfRange ? (
          <Badge
            variant={decision?.ready ? "warning" : "muted"}
            className="font-mono"
          >
            {decision === null
              ? "вне диапазона"
              : decision.ready
                ? "срок вышел"
                : `ждать ${Math.ceil(decision.hoursLeft)} ч`}
          </Badge>
        ) : (
          <Badge variant="success">в диапазоне</Badge>
        )
      }
    >
      {range !== null && <RangeBar range={range} outOfRange={outOfRange} />}

      {outOfRange ? (
        <>
          {since !== null && (
            <>
              {"Вне диапазона "}
              <span className="text-foreground">
                {formatRelativeTime(since, nowMs)}
              </span>
              {". "}
            </>
          )}
          {asset && side !== null && (
            <>{`Позиция целиком в ${asset} — цена ушла ${side === "down" ? "вниз" : "вверх"}. `}</>
          )}
          {since === null
            ? `Момент выхода не записан — отсчет ${RANGE_WAIT_HOURS} часов пойдет с ближайшего обновления.`
            : decision?.ready
              ? "Срок ожидания вышел — по стратегии можно действовать: "
              : "По стратегии ждем 48 часов (в выходные — до понедельника), затем "}
          {since !== null &&
            (side === "down"
              ? "закрыть позицию и увести актив — в залог под HF, в пулы BTC↔BTC / ETH↔stETH или на лендинг с наградами."
              : side === "up"
                ? "закрыть позицию, забрать стейблы и открыть новую с актуальным диапазоном."
                : "решить по позиции.")}
          {decision && !decision.ready && decision.postponedToMonday && (
            <> Срок выпал на выходные — ждем понедельника.</>
          )}
        </>
      ) : (
        "Пока цена в диапазоне, позиция собирает комиссии — по стратегии делать с ней нечего."
      )}
    </CardFooter>
  );
}

/**
 * Полоса диапазона: границы с ручками, текущая цена и запас до каждой
 * границы.
 *
 * Шкала логарифмическая — как сами тики: положение приходит уже
 * посчитанным (0 — нижняя граница, 1 — верхняя), и значения за этими
 * пределами означают выход. Поля по краям оставлены нарочно: маркер вне
 * диапазона должен быть виден, а не упираться в торец полосы.
 *
 * Проценты под границами — расстояние от ТЕКУЩЕЙ цены до каждой из них:
 * «до нижней −22%, до верхней +4%» отвечает на вопрос «скоро ли выход»
 * быстрее, чем сами цены, — их еще надо мысленно поделить.
 *
 * Текущая цена вынесена наверх отдельной дорожкой: у самой границы она
 * иначе накрывала бы подпись этой границы.
 */
const BAND_START = 0.14;
const BAND_END = 0.86;

function RangeBar({
  range,
  outOfRange,
}: {
  range: PositionRangeDto;
  outOfRange: boolean;
}) {
  const { position, currentPrice, lowerPrice, upperPrice } = range;
  const accent = outOfRange ? "var(--color-warning)" : UNI_ACCENT;

  return (
    <span className="mt-2 mb-1 block">
      {/* Дорожка текущей цены: бейдж едет за маркером, но не за край */}
      <span className="relative block h-5">
        {currentPrice !== null && position !== null && (
          <span
            className="absolute top-0 rounded-md bg-popover px-1.5 py-0.5 font-mono text-xs font-medium ring-1 ring-border"
            style={badgePosition(markerPercent(position))}
          >
            {priceLabel(currentPrice)}
          </span>
        )}
      </span>

      <span
        className="relative block h-1.5 rounded-full bg-muted"
        role="img"
        aria-label={rangeLabel(range)}
      >
        <span
          aria-hidden
          className="absolute inset-y-0"
          style={{
            left: `${BAND_START * 100}%`,
            right: `${(1 - BAND_END) * 100}%`,
            background: accent,
          }}
        />
        <Handle at={BAND_START} color={accent} />
        <Handle at={BAND_END} color={accent} />

        {position !== null && (
          <span
            aria-hidden
            // Треугольник над полосой: на полосе в 6px тонкая риска
            // теряется, а стрелка читается и не спорит с ручками
            className="absolute -top-1.5 size-2 -translate-x-1/2"
            style={{
              left: `${markerPercent(position)}%`,
              background: "var(--color-foreground)",
              clipPath: "polygon(50% 100%, 0 0, 100% 0)",
            }}
          />
        )}
      </span>

      {/* Границы с расстоянием до них — под ручками, а не по краям блока */}
      <span className="relative mt-2 block h-8">
        <Bound at={BAND_START} price={lowerPrice} currentPrice={currentPrice} />
        <Bound at={BAND_END} price={upperPrice} currentPrice={currentPrice} />
      </span>

      {currentPrice === null && (
        <span className="block text-xs text-muted-foreground">
          цена пула не прочитана — обновите данные
        </span>
      )}
    </span>
  );
}

/** Ручка на конце диапазона — как у ползунка: граница задана, а не размыта. */
function Handle({ at, color }: { at: number; color: string }) {
  return (
    <span
      aria-hidden
      className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{ left: `${at * 100}%`, background: color }}
    />
  );
}

/** Подпись границы: цена и сколько до нее от текущей цены. */
function Bound({
  at,
  price,
  currentPrice,
}: {
  at: number;
  price: number | null;
  currentPrice: number | null;
}) {
  const distance =
    price !== null && currentPrice !== null && currentPrice > 0
      ? (price / currentPrice - 1) * 100
      : null;

  return (
    <span
      className="absolute top-0 -translate-x-1/2 text-center"
      style={{ left: `${labelPercent(at)}%` }}
    >
      <span className="block font-mono text-xs whitespace-nowrap">
        {priceLabel(price)}
      </span>
      {/* Без текущей цены расстояния нет — и строки под ценой тоже */}
      {distance !== null && (
        <span className="block text-[11px] whitespace-nowrap text-muted-foreground">
          {tablePctSigned(distance, Math.abs(distance) >= 10 ? 1 : 2)}
        </span>
      )}
    </span>
  );
}

/** Описание для скринридера: полоса — картинка, числа под ней те же. */
function rangeLabel(range: PositionRangeDto): string {
  const bounds = `${priceLabel(range.lowerPrice)} … ${priceLabel(range.upperPrice)} ${range.quoteSymbol} за ${range.baseSymbol}`;
  if (range.currentPrice === null) return `Диапазон ${bounds}`;
  return `Диапазон ${bounds}; цена ${priceLabel(range.currentPrice)}${
    range.outsidePercent === null ? " внутри диапазона" : " вне диапазона"
  }`;
}

/**
 * Бейдж цены у края прижимается к нему целиком, а не центрируется: иначе
 * его половина уезжает за карточку, и он отрывается от своего маркера.
 */
function badgePosition(marker: number): React.CSSProperties {
  if (marker > 82) return { right: 0 };
  if (marker < 18) return { left: 0 };
  return { left: `${marker}%`, transform: "translateX(-50%)" };
}

/** Подпись границы центрирована по ручке и в поле помещается. */
function labelPercent(position: number): number {
  return Math.min(88, Math.max(12, markerPercent(position)));
}

/**
 * Положение маркера в процентах ширины. Внутри диапазона — линейно по
 * полосе, снаружи — в поле у края, пропорционально удалению, но не
 * дальше торца: «очень далеко» и «невероятно далеко» на глаз одинаковы.
 */
function markerPercent(position: number): number {
  if (position >= 0 && position <= 1) {
    return (BAND_START + position * (BAND_END - BAND_START)) * 100;
  }
  if (position < 0) {
    return BAND_START * (1 - Math.min(1, -position)) * 100;
  }
  return (BAND_END + (1 - BAND_END) * Math.min(1, position - 1)) * 100;
}

/** Цена в человеческом виде; null = границы нет (позиция на весь диапазон). */
function priceLabel(price: number | null): string {
  if (price === null) return "без границы";
  // До десяти тысяч копейки различимы и нужны: диапазон бывает узким
  if (price >= 10_000) return tableNumber(price, 0);
  if (price >= 1) return tableNumber(price, 2);
  return tableNumber(price, 6);
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
