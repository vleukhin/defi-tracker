"use client";

import { BarBlock } from "@/components/dc/bar";
import { Verdict } from "@/components/dc/card";
import { Chip, StatusChip } from "@/components/dc/chip";
import { Metric } from "@/components/dc/metrics";
import type { GmJournalDto, PositionDto } from "@/lib/api/types";
import { chainLabel, dcPp, dcUsd, tablePct, tableSigned } from "@/lib/format";
import { gmLevels } from "@/lib/positions/gm-levels";
import { GM_SHARE_TOLERANCE_PP, gmShare } from "@/lib/positions/gm-split";
import {
  CardHead,
  componentQuantities,
  componentSegments,
  MetricRow,
  ownershipDelta,
  ownershipSegments,
  PlainBlock,
  PositionShell,
  principalOf,
  profitDelta,
  splitNote,
  UnmarkedChip,
  VisualRow,
} from "./card-parts";
import { GmLevelsPopover } from "./gm-levels-popover";
import { MarkPopover } from "./mark-popover";
import { type MarkFn } from "./shared";

/**
 * Карточка GM-пула GMX v2. В дизайне отдельного типа у неё нет — она
 * собрана из того же каркаса, что LP и депозит, а наполнение подобрано
 * по вопросам, на которые стратегия отвечает у GM.
 *
 * У GM нет ни ставки, как у депозита, ни диапазона, как у CLMM: доход
 * появляется переоценкой, а действия стратегия привязывает к уровням
 * падения и роста. Уровни считаются от подвижной точки отсчёта — цены
 * базового актива на входе; она задаётся разметкой позиции, а шкала
 * уровней живёт в поповере за кнопкой в шапке (gm-levels-popover.tsx).
 *
 * «Выведено»: по стратегии (§5) на уровнях −7 / −15% часть GM продают,
 * а полученные BTC/ETH уходят в залог Growth. Без этого числа позиция
 * выглядит убыточной, хотя капитал не потерян, а переехал.
 *
 * «Доля в GM»: рабочий сплит по стратегии (§8) — 70% BTC/USDC и 30%
 * ETH/USDC; выравнивают его при следующей покупке GM, и для этого нужно
 * видеть перекос.
 */
export function GmxCard({
  position,
  positions,
  busy,
  onMark,
  journal,
  onJournalRefetch,
}: {
  position: PositionDto;
  /** Все позиции экрана — из них считается доля пула среди GM. */
  positions: PositionDto[];
  busy: boolean;
  onMark: MarkFn;
  journal: GmJournalDto | null;
  onJournalRefetch: () => Promise<void>;
}) {
  const principal = principalOf(position);
  // null трактуется как ноль: отсутствие выводов — обычное состояние
  const withdrawn = position.withdrawnUsd ?? 0;
  const share = gmShare(position, positions);
  const levels = gmLevels(
    position,
    journal?.points[0]?.actions.map((action) => action.dropPercent),
  );
  const offTarget =
    share.deviationPp !== null &&
    Math.abs(share.deviationPp) > GM_SHARE_TOLERANCE_PP;

  const composition = componentSegments(position.components, {
    withSide: true,
  });
  const ownership = ownershipSegments(position);

  return (
    <PositionShell>
      <CardHead
        protocol="gmx"
        name="GMX v2"
        zone={position.zone}
        kind={
          <>
            <UnmarkedChip position={position} />
            {/* Без точки отсчёта уровни не считаются вовсе, и молчать
                об этом нельзя: кнопка шкалы в таком виде просто пуста */}
            {levels.entryPriceUsd === null && <Chip>без точки отсчёта</Chip>}
          </>
        }
        meta={[position.title, chainLabel(position.chain)]}
        status={
          share.deviationPp === null ? undefined : offTarget ? (
            <StatusChip tone="warn">
              {`${tableSigned(share.deviationPp, 1)}%`}
            </StatusChip>
          ) : (
            <Chip>{`${tableSigned(share.deviationPp, 1)}%`}</Chip>
          )
        }
        menu={
          <>
            <GmLevelsPopover
              position={position}
              journal={journal}
              busy={busy}
              onJournalRefetch={onJournalRefetch}
            />
            <MarkPopover position={position} busy={busy} onMark={onMark} />
          </>
        }
      />

      <MetricRow>
        <Metric
          label="Стоимость"
          value={position.valueUsd === null ? null : dcUsd(position.valueUsd)}
          delta={profitDelta(position)}
        />
        <Metric
          label="Выведено"
          hint="Стоимость того, что забрали из позиции на момент вывода. Доход считается как «стоимость + выведено − вложено»."
          value={dcUsd(withdrawn)}
          delta={
            withdrawn > 0
              ? "продано с переводом в залог — капитал переехал в Growth"
              : "на уровнях −7 / −15% часть GM продают"
          }
        />
        <Metric
          label="Вложено"
          value={principal === null ? null : dcUsd(principal)}
          delta={ownershipDelta(position)}
        />
        <Metric
          label="Доля в GM"
          hint="Доля пула в стоимости всех GM-пулов. Рабочий сплит стратегии — 70% BTC/USDC и 30% ETH/USDC."
          value={
            share.sharePercent === null ? null : tablePct(share.sharePercent, 1)
          }
          mono={false}
          tone={offTarget ? "warn" : undefined}
          delta={
            share.targetPercent === null
              ? "рынок вне двух базовых активов"
              : `цель ${tablePct(share.targetPercent, 0)}`
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

      {/* Строка-вывод одна, и уровень забирает её себе: пройденный уровень —
          повод действовать сегодня, а перекос сплита выравнивают при
          следующей покупке GM, то есть когда-нибудь потом */}
      <Verdict>
        {levels.lastReached !== null
          ? `Пройден уровень ${dcPp(-levels.lastReached.dropPercent, 0)}: по стратегии на нём ${levels.lastReached.action}.`
          : share.sharePercent === null
            ? "Стоимость части GM-пулов неизвестна — доля не считается."
            : share.targetPercent === null
              ? "Рынок вне двух базовых активов: рабочий сплит стратегии его не задаёт."
              : offTarget
                ? "Перекос сплита выравнивают при следующей покупке GM, а не продажей."
                : "Сплит внутри GM держится цели стратегии — 70% BTC/USDC и 30% ETH/USDC."}
      </Verdict>
    </PositionShell>
  );
}
