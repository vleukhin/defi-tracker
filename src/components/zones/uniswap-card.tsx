"use client";

import { BarBlock, RangeBar } from "@/components/dc/bar";
import { Chip, StatusChip, type StatusTone } from "@/components/dc/chip";
import { Verdict } from "@/components/dc/card";
import { Metric } from "@/components/dc/metrics";
import type {
  PositionComponentDto,
  PositionDto,
  PositionRangeDto,
} from "@/lib/api/types";
import {
  chainLabel,
  dcUsd,
  formatRelativeTime,
  tablePct,
  tablePctSigned,
} from "@/lib/format";
import { rangeDecision, RANGE_WAIT_HOURS } from "@/lib/positions/range-timer";
import { symbolCategory } from "@/lib/symbol-category";
import {
  CardHead,
  MetaMono,
  MetricRow,
  componentQuantities,
  componentSegments,
  ownershipDelta,
  ownershipSegments,
  PlainBlock,
  PositionShell,
  priceLabel,
  principalOf,
  profitDelta,
  splitNote,
  tokenQuantity,
  UnmarkedChip,
  VisualRow,
} from "./card-parts";
import { MarkPopover } from "./mark-popover";
import { type MarkFn } from "./shared";

/**
 * Карточка LP-позиции Uniswap v3 — тип «LP», зона Yield.
 *
 * У пула нет ставки: доход складывается из комиссий и переоценки состава,
 * поэтому вместо «ставки сейчас» на карточке несобранные комиссии — их
 * позиция накопила, но в стоимость они не входят и при выводе приходят
 * отдельно.
 *
 * Главный же вопрос к CLMM-позиции стратегия задаёт не про доход, а про
 * диапазон (docs/07 §5, §6): вышла ли цена и в какую сторону. От стороны
 * зависит действие — по нижней границе позиция стала волатильным активом
 * и его уводят в Growth, по верхней стала стейблами и диапазон
 * перезаливают. И в обоих случаях ждут ~48 часов, а не дёргаются сразу,
 * поэтому в выводе не только факт выхода, но и сколько ждать осталось.
 *
 * Сторона определяется по составу, а не по тикам: token0/token1 в пуле
 * упорядочены по адресам, и «верхняя граница» в терминах тика означает
 * разное в зависимости от того, каким из токенов оказался стейбл.
 */

/**
 * Поля диапазона в процентах ширины полосы. Активный участок не упирается
 * в торцы нарочно: маркер вышедшей цены должен быть виден, а не сливаться
 * с краем.
 */
const BAND_START = 8;
const BAND_END = 92;

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
  const principal = principalOf(position);
  const range = position.range;
  const status = rangeStatus(position);
  const fees = position.feesUsd;
  const composition = componentSegments(position.components);
  const ownership = ownershipSegments(position);

  return (
    <PositionShell>
      <CardHead
        protocol="uniswap"
        name="Uniswap v3"
        zone={position.zone}
        kind={<UnmarkedChip position={position} />}
        meta={[
          position.title,
          chainLabel(position.chain),
          <ComponentsMeta key="components" components={position.components} />,
        ]}
        status={<StatusChip tone={status.tone}>{status.label}</StatusChip>}
        menu={<MarkPopover position={position} busy={busy} onMark={onMark} />}
      />

      <MetricRow>
        <Metric
          label="Стоимость"
          value={position.valueUsd === null ? null : dcUsd(position.valueUsd)}
          delta={profitDelta(position)}
        />
        <Metric
          label="Комиссии"
          hint="Не собранные комиссии: позиция их накопила, но в стоимость они не входят и приходят отдельно при выводе."
          value={fees === null ? null : dcUsd(fees)}
          delta={
            fees === null
              ? "не прочитаны — симуляция сбора не удалась"
              : principal !== null && principal > 0
                ? `не собраны · ${tablePct((fees / principal) * 100, 2)} к вложенному`
                : "не собраны"
          }
        />
        <Metric
          label="Вложено"
          value={principal === null ? null : dcUsd(principal)}
          delta={ownershipDelta(position)}
        />
        <Metric
          label="Цена / диапазон"
          value={
            range?.currentPrice == null
              ? null
              : priceLabel(range.currentPrice)
          }
          delta={
            range === null
              ? "у позиции нет диапазона"
              : `${range.quoteSymbol} за ${range.baseSymbol}`
          }
        />
      </MetricRow>

      <VisualRow>
        {composition === null ? (
          <PlainBlock label="Состав">
            {componentQuantities(position.components)}
            {" — цен компонентов нет, доли не считаются"}
          </PlainBlock>
        ) : (
          <BarBlock
            label="Состав"
            total={splitNote(composition)}
            segments={composition}
            ariaLabel={`Состав: ${composition
              .map((s) => `${s.label} ${tablePct(s.percent, 1)}`)
              .join(", ")}`}
          />
        )}
        {ownership === null ? (
          <PlainBlock label="Чьи деньги">
            Своё и заёмное не размечены — доход и собственная доля
            не считаются.
          </PlainBlock>
        ) : (
          <BarBlock
            label="Чьи деньги"
            total={principal === null ? undefined : dcUsd(principal)}
            segments={ownership}
            ariaLabel={`Вложено: ${ownership
              .map((s) => `${s.label} ${s.value}`)
              .join(", ")}`}
          />
        )}
      </VisualRow>

      {range !== null && <PriceRange range={range} />}

      <RangeVerdict position={position} nowMs={nowMs} />
    </PositionShell>
  );
}

/** Состав в мета-строке: «25,1223 WETH + 43 512 USDC». */
function ComponentsMeta({
  components,
}: {
  components: PositionComponentDto[];
}) {
  const held = components.filter((c) => c.quantity > 0);
  if (held.length === 0) return null;
  return (
    <>
      {held.map((c, index) => (
        <span key={`${c.symbol}-${c.side ?? "flat"}`}>
          {index > 0 && <span className="text-text-4"> + </span>}
          <MetaMono>{tokenQuantity(c.quantity)}</MetaMono>
          {` ${c.symbol}`}
        </span>
      ))}
    </>
  );
}

/**
 * Полоса диапазона: где цена относительно границ.
 *
 * Проценты у границ — расстояние от ТЕКУЩЕЙ цены до каждой из них:
 * «до нижней −18,8%, до верхней +8,99%» отвечает на вопрос «скоро ли
 * выход» быстрее, чем сами цены, — их ещё надо мысленно поделить.
 */
function PriceRange({ range }: { range: PositionRangeDto }) {
  const { currentPrice, lowerPrice, upperPrice, position } = range;

  return (
    <RangeBar
      className="border-line border-t"
      lowPercent={BAND_START}
      highPercent={BAND_END}
      position={markerPercent(position)}
      priceLabel={priceLabel(currentPrice)}
      lowLabel={
        <BoundLabel
          price={lowerPrice}
          currentPrice={currentPrice}
          align="start"
        />
      }
      highLabel={
        <BoundLabel price={upperPrice} currentPrice={currentPrice} align="end" />
      }
    />
  );
}

/** Подпись границы: цена и сколько до неё от текущей цены. */
function BoundLabel({
  price,
  currentPrice,
  align,
}: {
  price: number | null;
  currentPrice: number | null;
  align: "start" | "end";
}) {
  const distance =
    price !== null && currentPrice !== null && currentPrice > 0
      ? (price / currentPrice - 1) * 100
      : null;
  const value = <span className="font-mono text-text-2">{priceLabel(price)}</span>;
  const gap =
    distance === null ? null : (
      <span>{tablePctSigned(distance, Math.abs(distance) >= 10 ? 1 : 2)}</span>
    );

  return (
    <span className="flex items-baseline gap-[7px]">
      {align === "start" ? (
        <>
          {value}
          {gap}
        </>
      ) : (
        <>
          {gap}
          {value}
        </>
      )}
    </span>
  );
}

/**
 * Вывод по диапазону — одно утверждение, а не инструкция.
 * Правило 48 часов (docs/07 §5–§7) живёт тут же: вышедшая позиция сама
 * по себе не повод действовать, повод — вышедший срок ожидания.
 */
function RangeVerdict({
  position,
  nowMs,
}: {
  position: PositionDto;
  nowMs: number;
}) {
  if (position.inRange !== false) {
    return (
      <Verdict>
        Пока цена в диапазоне, позиция собирает комиссии — по стратегии делать
        с ней нечего.
      </Verdict>
    );
  }

  const since = position.outOfRangeSince;
  const decision = since === null ? null : rangeDecision(since, nowMs);
  const side = exitSide(position.components);
  const asset = position.components.find((c) => c.quantity > 0)?.symbol;

  if (decision === null) {
    return (
      <Verdict chip={<Chip>вне диапазона</Chip>}>
        {`Момент выхода не записан — отсчёт ${RANGE_WAIT_HOURS} часов пойдёт с ближайшего обновления.`}
      </Verdict>
    );
  }

  if (!decision.ready) {
    return (
      <Verdict chip={<Chip>{`ждать ${Math.ceil(decision.hoursLeft)} ч`}</Chip>}>
        {`Вне диапазона ${formatRelativeTime(since, nowMs) ?? "недавно"} — по стратегии ждём ${RANGE_WAIT_HOURS} часов${
          decision.postponedToMonday ? ", срок сдвинут на понедельник" : ""
        }.`}
      </Verdict>
    );
  }

  return (
    <Verdict chip={<Chip>срок вышел</Chip>}>
      {side === "down"
        ? `Срок ожидания вышел: позиция целиком в ${asset ?? "базовом активе"} — по стратегии актив уходит в Growth.`
        : side === "up"
          ? "Срок ожидания вышел: позиция целиком в стейблах — по стратегии диапазон перезаливают."
          : "Срок ожидания вышел — по стратегии позицию пора закрывать."}
    </Verdict>
  );
}

/** Статус диапазона: у границы позиция ещё работает, но уже почти вышла. */
function rangeStatus(position: PositionDto): {
  tone: StatusTone;
  label: string;
} {
  if (position.inRange === false) return { tone: "loss", label: "вне диапазона" };
  const at = position.range?.position;
  if (at != null && (at < 0.06 || at > 0.94)) {
    return { tone: "warn", label: "на границе" };
  }
  return { tone: "profit", label: "в диапазоне" };
}

/**
 * Положение маркера в процентах ширины. Внутри диапазона — линейно по
 * активному участку, снаружи — в поле у края, пропорционально удалению,
 * но не дальше торца: «очень далеко» и «невероятно далеко» на глаз
 * одинаковы. null (цена не прочитана) ставит маркер в середину — числа
 * рядом всё равно скажут «—».
 */
function markerPercent(position: number | null): number {
  if (position === null) return (BAND_START + BAND_END) / 2;
  if (position >= 0 && position <= 1) {
    return BAND_START + position * (BAND_END - BAND_START);
  }
  if (position < 0) return BAND_START * (1 - Math.min(1, -position));
  return BAND_END + (100 - BAND_END) * Math.min(1, position - 1);
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
