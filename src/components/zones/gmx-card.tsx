"use client";

import { Badge } from "@/components/ui/badge";
import type { PositionComponentDto, PositionDto } from "@/lib/api/types";
import {
  chainLabel,
  tablePct,
  tableSigned,
  tableUsd,
} from "@/lib/format";
import { GM_SHARE_TOLERANCE_PP, gmShare } from "@/lib/positions/gm-split";
import { categoryColor } from "@/lib/symbol-category";
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
  tokenQuantity,
  UnmarkedBadge,
} from "./card-parts";
import { ProfitValue } from "./position-card";
import { type MarkFn } from "./shared";

/**
 * Карточка GM-пула GMX v2.
 *
 * У GM нет ни ставки, как у депозита, ни диапазона, как у CLMM: доход
 * появляется переоценкой, а действия стратегия привязывает к уровням
 * падения и роста. Уровни считаются от подвижной точки отсчета, которой
 * в приложении пока нет (docs/07 §10.3), поэтому карточка отвечает на два
 * вопроса, которые ответить можно.
 *
 * Первый — «выведено». По стратегии (§5) на уровнях −7 / −15% часть GM
 * продают, а полученные BTC/ETH уходят в залог Growth. Без этого числа
 * позиция выглядит убыточной, хотя капитал не потерян, а переехал: доход
 * считается как «стоимость + выведено − вложено», и слагаемое, которое
 * все объясняет, должно быть на виду.
 *
 * Второй — доля пула среди GM. Рабочий сплит по стратегии (§8) — 70%
 * BTC/USDC и 30% ETH/USDC; выравнивают его при следующей покупке GM,
 * и для этого нужно видеть перекос.
 *
 * Отдельная строчка про оценку: стоимость GM дает оракул GMX, и она
 * включает незакрытый PnL трейдеров. Сумма состава с ней не сходится —
 * это не ошибка чтения, а устройство пула, поэтому разница подписана.
 */

/** Фирменный сине-голубой GMX. Только заливкой — не текстом. */
const GMX_ACCENT = "#1aa7ec";
const GMX_ACCENT_LIGHT = "#5fd8ff";

/** Расхождение оценки с составом ниже этого — округление, не PnL трейдеров. */
const ORACLE_GAP_TOLERANCE_PERCENT = 0.5;

export function GmxCard({
  position,
  positions,
  busy,
  onMark,
}: {
  position: PositionDto;
  /** Все позиции экрана — из них считается доля пула среди GM. */
  positions: PositionDto[];
  busy: boolean;
  onMark: MarkFn;
}) {
  const own = position.ownPrincipalUsd;
  const borrowed = position.borrowedPrincipalUsd;
  const principal = own !== null && borrowed !== null ? own + borrowed : null;

  // null трактуется как ноль: отсутствие выводов — обычное состояние
  const withdrawn = position.withdrawnUsd ?? 0;
  const share = gmShare(position, positions);

  return (
    <ProtocolCard accent={GMX_ACCENT}>
      <CardHead
        mark={<GmxMark />}
        name="GMX v2"
        subtitle={`${position.title} · ${chainLabel(position.chain)}`}
        badges={<UnmarkedBadge principal={principal} />}
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

        <CardMetric label="Выведено" value={tableUsd(withdrawn)}>
          {withdrawn > 0
            ? "продано с переводом BTC/ETH в залог — не убыток, а переезд капитала в Growth"
            : "на уровнях −7 / −15% часть GM продают, BTC/ETH уходят в залог; выведенное входит в доход"}
        </CardMetric>
      </CardMetrics>

      <CardSection label="Состав">
        <SidesBar
          components={position.components}
          valueUsd={position.valueUsd}
        />
      </CardSection>

      <CardSection
        label="Вложено"
        value={principal === null ? null : tableUsd(principal)}
      >
        <OwnershipBar own={own} borrowed={borrowed} accent={GMX_ACCENT} />
      </CardSection>

      <CardFooter
        title={
          <>
            {"Доля в GM-пулах — "}
            <span className="font-mono text-foreground">
              {share.sharePercent === null
                ? "—"
                : tablePct(share.sharePercent, 1)}
            </span>
            {share.targetPercent !== null && (
              <>
                {" · цель "}
                <span className="font-mono">
                  {tablePct(share.targetPercent, 0)}
                </span>
              </>
            )}
          </>
        }
        badge={
          share.deviationPp !== null && (
            <Badge
              variant={
                Math.abs(share.deviationPp) > GM_SHARE_TOLERANCE_PP
                  ? "warning"
                  : "muted"
              }
              className="font-mono"
            >
              {`${tableSigned(share.deviationPp, 1)} п.п.`}
            </Badge>
          )
        }
      >
        {share.sharePercent === null
          ? "Стоимость части GM-пулов неизвестна — доля не считается."
          : share.targetPercent === null
            ? "Рынок вне двух базовых активов: рабочий сплит стратегии его не задает."
            : share.deviationPp !== null &&
                Math.abs(share.deviationPp) > GM_SHARE_TOLERANCE_PP
              ? "Сплит внутри GM по стратегии — 70% BTC/USDC и 30% ETH/USDC. Перекос выравнивают при следующей покупке GM, а не продажей."
              : "Сплит внутри GM по стратегии — 70% BTC/USDC и 30% ETH/USDC, как в портфеле."}
      </CardFooter>
    </ProtocolCard>
  );
}

/**
 * Состав пула по сторонам: длинная — базовый актив рынка, короткая — стейбл.
 * Красится языком категорий портфеля (ТЗ §1.3).
 *
 * Под полосой — расхождение суммы состава с оценкой оракула: цену GM дает
 * GMX (Reader.getMarketTokenPrice), и она включает незакрытый PnL трейдеров.
 * Сумма сторон его не показывает, поэтому числа и расходятся.
 */
function SidesBar({
  components,
  valueUsd,
}: {
  components: PositionComponentDto[];
  valueUsd: number | null;
}) {
  const priced = components.every((c) => c.valueUsd !== null);
  const total = priced
    ? components.reduce((sum, c) => sum + (c.valueUsd ?? 0), 0)
    : 0;

  if (!priced || total <= 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {components.map((c, i) => (
          <span key={`${c.symbol}-${c.side}`}>
            {i > 0 && " · "}
            <span className="font-mono">{tokenQuantity(c.quantity)}</span>
            {` ${c.symbol}`}
          </span>
        ))}
        {!priced && " — цены компонентов нет, доли не считаются"}
      </p>
    );
  }

  const segments = components
    .map((c) => ({
      label: `${c.symbol} · ${c.side === "long" ? "long" : "short"}`,
      value: tokenQuantity(c.quantity),
      percent: ((c.valueUsd ?? 0) / total) * 100,
      color: categoryColor(c.symbol),
    }))
    .filter((s) => s.percent > 0);

  const gapUsd = valueUsd === null ? null : valueUsd - total;
  const gapMatters =
    gapUsd !== null &&
    Math.abs(gapUsd) / total > ORACLE_GAP_TOLERANCE_PERCENT / 100;

  return (
    <>
      <SplitBar
        ariaLabel={`Состав: ${segments
          .map((s) => `${s.label} ${tablePct(s.percent, 1)}`)
          .join(", ")}`}
        segments={segments}
      />
      {gapMatters && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {"Стороны в сумме — "}
          <span className="font-mono">{tableUsd(total)}</span>
          {"; оценка оракула отличается на "}
          <span className="font-mono">{tableSigned(gapUsd, 0)}</span>
          {" — это незакрытый PnL трейдеров, он в цене GM учтен."}
        </p>
      )}
    </>
  );
}

/** Знак GMX — угловатая метка в фирменном голубом. */
function GmxMark() {
  return (
    <ProtocolMark from={GMX_ACCENT} to={GMX_ACCENT_LIGHT}>
      <path fill="#fff" d="M12 3.4 20.4 18H14l-2-3.6L10 18H3.6z" />
      <path fill={GMX_ACCENT} fillOpacity="0.4" d="M12 9.4 16.6 18h-9.2z" />
    </ProtocolMark>
  );
}
