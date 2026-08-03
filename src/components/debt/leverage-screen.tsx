"use client";

import { Link2Off, Plus, X } from "lucide-react";
import { useState } from "react";
import { DcBlock, DcCard, SectionHead, Verdict } from "@/components/dc/card";
import { StatusChip } from "@/components/dc/chip";
import { HelpTip } from "@/components/dc/help-tip";
import { Metric, MetricGrid } from "@/components/dc/metrics";
import { ProtocolTile } from "@/components/dc/page-header";
import { protocolBrand } from "@/components/dc/protocols";
import { Dash } from "@/components/dc/table";
import { Button } from "@/components/ui/button";
import type {
  LeverageBorrowDto,
  LeverageResponseDto,
  PositionDto,
} from "@/lib/api/types";
import {
  chainLabel,
  dcUsd,
  dcUsdSigned,
  tablePctSigned,
  tableQuantity,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * «Займы и размещение» — карточка экрана «Долг» (была отдельная вкладка
 * «Левередж», Фаза 5).
 *
 * Отвечает на один вопрос: оправдывает ли себя связка «занял и вложил».
 * Привязка «займ → позиция» — бухгалтерская метка: ни на портфель, ни на
 * связку пяти чисел она не влияет, влияет только на числа этой карточки.
 *
 * Форма привязки не висит в потоке, а раскрывается по кнопке (дизайн-код
 * §8): правят её при заведении займа, а читают карточку каждый день.
 */

const AAVE = protocolBrand("aave");

export function LeverageCard({
  data,
  busy,
  onLink,
  onUnlink,
}: {
  data: LeverageResponseDto;
  busy: boolean;
  onLink: (borrowId: string, positionId: string) => void;
  onUnlink: (borrowId: string, positionId: string) => void;
}) {
  const { positions, borrows, summary, chains } = data;
  const failed = chains.filter((c) => !c.ok);

  return (
    <DcCard as="section">
      <SectionHead
        title="Займы и размещение"
        count={borrows.length}
        className="border-line border-b"
        hint="Привязка займа к позиции — метка для этой карточки: на портфель и на связку пяти чисел она не влияет."
        action={
          failed.length > 0 && (
            <StatusChip tone="warn">
              не прочитано источников: {failed.length}
              <HelpTip label="Какие источники не прочитаны">
                {failed
                  .map((c) => `${c.source} · ${chainLabel(c.chain)}`)
                  .join(", ")}
              </HelpTip>
            </StatusChip>
          )
        }
      />

      <MetricGrid>
        <Metric
          label="Размещено"
          hint="Вклад позиций в «Активы» — стоимость позиций за вычетом своих средств внутри них."
          value={
            summary.positionsUsd === null ? null : dcUsd(summary.positionsUsd)
          }
        />
        <Metric
          label="Привязанный долг"
          value={
            summary.linkedDebtUsd === null ? null : dcUsd(summary.linkedDebtUsd)
          }
        />
        <Metric
          label="Привязанные позиции"
          value={
            summary.linkedPositionsUsd === null
              ? null
              : dcUsd(summary.linkedPositionsUsd)
          }
        />
        <Metric
          label="Дельта связки"
          hint="Стоимость привязанных позиций минус профинансировавший их долг."
          tone={
            summary.linkedDeltaUsd === null
              ? undefined
              : summary.linkedDeltaUsd >= 0
                ? "profit"
                : "loss"
          }
          value={
            summary.linkedDeltaUsd === null
              ? null
              : dcUsdSigned(summary.linkedDeltaUsd)
          }
        />
      </MetricGrid>

      {borrows.length === 0 ? (
        <p className="t-meta border-line border-t px-card py-6 text-text-3">
          Займов не прочитано.
        </p>
      ) : (
        <ul className="grid gap-px border-line border-t bg-line">
          {borrows.map((borrow) => (
            <BorrowRow
              key={borrow.id}
              borrow={borrow}
              positions={positions}
              busy={busy}
              onLink={onLink}
              onUnlink={onUnlink}
            />
          ))}
        </ul>
      )}

      <Verdict>
        {summary.ownUsd > 0
          ? `В «Активы» позиции входят за вычетом своих ${dcUsd(summary.ownUsd)} — эта доля уже посчитана категорией «Стейблы».`
          : "Собственных средств внутри позиций не размечено — они считаются целиком заёмными."}
        {summary.unmarkedCount > 0 &&
          ` Без разметки: ${summary.unmarkedCount}.`}
        {summary.unpricedCount > 0 && ` Без оценки: ${summary.unpricedCount}.`}
      </Verdict>
    </DcCard>
  );
}

/** Один займ: долг, привязанные позиции, дельта и раскрываемая привязка. */
function BorrowRow({
  borrow,
  positions,
  busy,
  onLink,
  onUnlink,
}: {
  borrow: LeverageBorrowDto;
  positions: PositionDto[];
  busy: boolean;
  onLink: (borrowId: string, positionId: string) => void;
  onUnlink: (borrowId: string, positionId: string) => void;
}) {
  const [pick, setPick] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const linked = positions.filter((p) =>
    borrow.linkedPositionIds.includes(p.id),
  );
  const available = positions.filter(
    (p) => !borrow.linkedPositionIds.includes(p.id),
  );

  return (
    <li className="bg-surface px-card py-3.5">
      <div className="flex items-center gap-3">
        <ProtocolTile abbr={AAVE.abbr} color={AAVE.color} size={30} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium">
            {borrow.symbol} · {chainLabel(borrow.chain)}
          </p>
          <p className="truncate text-[12px] text-text-3">
            {tableQuantity(borrow.quantity)} {borrow.symbol}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[13px] font-medium">
          {borrow.debtUsd === null ? <Dash /> : dcUsd(borrow.debtUsd)}
        </span>
      </div>

      {linked.length === 0 ? (
        <p className="mt-2.5 text-[12px] text-text-3">
          Не привязан ни к одной позиции — во что ушли эти деньги, неизвестно.
        </p>
      ) : (
        <DcBlock className="mt-2.5 px-3 py-2.5">
          <ul className="grid gap-1.5">
            {linked.map((position) => (
              <li
                key={position.id}
                className="flex items-center justify-between gap-3"
              >
                <span className="min-w-0 truncate text-[12.5px] text-text-2">
                  {position.title}
                  <span className="ml-1.5 text-text-3">
                    {position.protocolLabel}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="font-mono text-[12.5px]">
                    {position.valueUsd === null ? (
                      <Dash />
                    ) : (
                      dcUsd(position.valueUsd)
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy}
                    onClick={() => onUnlink(borrow.id, position.id)}
                    aria-label={`Снять привязку: ${position.title}`}
                    title="Снять привязку"
                  >
                    <Link2Off />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 flex items-baseline justify-between gap-3 border-line border-t pt-2.5 text-[12px] text-text-3">
            <span>
              позиции{" "}
              <span className="font-mono text-text-2">
                {borrow.linkedUsd === null ? "—" : dcUsd(borrow.linkedUsd)}
              </span>
            </span>
            <span>
              дельта{" "}
              <span
                className={cn(
                  "font-mono",
                  borrow.deltaUsd === null
                    ? "text-text-3"
                    : borrow.deltaUsd >= 0
                      ? "text-profit"
                      : "text-loss",
                )}
              >
                {borrow.deltaUsd === null ? "—" : dcUsdSigned(borrow.deltaUsd)}
                {borrow.deltaPct !== null &&
                  ` · ${tablePctSigned(borrow.deltaPct, 1)}`}
              </span>
            </span>
          </p>
        </DcBlock>
      )}

      {available.length > 0 &&
        (formOpen ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <label htmlFor={`link-${borrow.id}`} className="sr-only">
              Позиция для привязки
            </label>
            <select
              id={`link-${borrow.id}`}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-control min-w-0 flex-1 rounded-control border border-line-card bg-sunken px-2.5 text-[13px] text-text-1 outline-none transition-colors duration-120 ease-out focus-visible:border-[var(--accent)] focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">Выберите позицию…</option>
              {available.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.title} · {position.protocolLabel} ·{" "}
                  {chainLabel(position.chain)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || pick === ""}
              onClick={() => {
                onLink(borrow.id, pick);
                setPick("");
                setFormOpen(false);
              }}
            >
              Привязать
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Отмена"
              onClick={() => {
                setPick("");
                setFormOpen(false);
              }}
            >
              <X />
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-1.5 mt-2"
            aria-expanded={formOpen}
            onClick={() => setFormOpen(true)}
          >
            <Plus data-icon="inline-start" />
            Привязать позицию
          </Button>
        ))}
    </li>
  );
}
