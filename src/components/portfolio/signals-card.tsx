"use client";

import Link from "next/link";
import { useState } from "react";
import { DcCard, SectionHead, Verdict } from "@/components/dc/card";
import { Chip, StatusChip, type StatusTone } from "@/components/dc/chip";
import { HelpTip } from "@/components/dc/help-tip";
import {
  SIGNALS_VISIBLE,
  type Signal,
  type SignalSeverity,
} from "@/lib/signals/signals";
import { countLabel } from "./plural";

/**
 * Карточка «Что делать сейчас» — лента сигналов первым блоком «Портфеля».
 *
 * Собирается из уже загруженных экраном данных: своих запросов у неё нет,
 * своей арифметики тоже. Стоит выше hero потому же, почему до неё здесь
 * стояли баннеры деградации: если действие требуется, узнать об этом надо
 * раньше, чем прочесть итог портфеля.
 *
 * Пустая карточка схлопывается в две строки, а не разворачивается в
 * EmptyState: 200px пустоты перед главным числом экрана нарушали бы §8
 * дизайн-кода, а предлагать действие тут нечего — пусто здесь означает
 * «всё в порядке», а не «записей ещё нет».
 */

const HINT =
  "Лента собрана из уже загруженных данных экрана. Порядок задан стратегией: ликвидация — единственный сценарий, способный принудительно прервать накопление, поэтому риск всегда выше уровней, ставок и разметки.";

export function SignalsCard({
  signals,
  pending,
  onOpenZones,
}: {
  signals: Signal[];
  /** Часть источников ещё читается: «действий нет» показывать нельзя. */
  pending: boolean;
  /** Сигналы позиций живут в разрезе «Зоны» — это смена проекции, не переход. */
  onOpenZones: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? signals : signals.slice(0, SIGNALS_VISIBLE);
  const hidden = signals.length - visible.length;

  if (signals.length === 0) {
    return (
      <DcCard as="section">
        <SectionHead
          title="Что делать сейчас"
          hint={HINT}
          action={<Chip>{pending ? "читается…" : "действий нет"}</Chip>}
        />
        <Verdict>
          {pending
            ? "Часть данных ещё читается — лента пока неполна."
            : "По стратегии сейчас делать нечего: риск ликвидации в норме, уровни не пройдены, позиции и разметка в порядке."}
        </Verdict>
      </DcCard>
    );
  }

  return (
    <DcCard as="section">
      <SectionHead
        title="Что делать сейчас"
        hint={HINT}
        count={signals.length}
        className="border-line border-b"
        action={
          pending ? <Chip>часть данных читается</Chip> : undefined
        }
      />

      <ul className="grid gap-px bg-line">
        {visible.map((signal) => (
          <SignalRow
            key={signal.key}
            signal={signal}
            onOpenZones={onOpenZones}
          />
        ))}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="t-meta w-full border-line border-t px-card py-2.5 text-left text-link underline-offset-4 hover:underline"
        >
          {`Ещё ${countLabel(hidden, "сигнал", "сигнала", "сигналов")}`}
        </button>
      )}

      <Verdict>{verdictFor(signals, pending)}</Verdict>
    </DcCard>
  );
}

function SignalRow({
  signal,
  onOpenZones,
}: {
  signal: Signal;
  onOpenZones: () => void;
}) {
  return (
    <li className="flex flex-col gap-1.5 bg-surface px-card py-3 sm:flex-row sm:items-start sm:gap-3">
      {/* Колонка чипов держит ширину, иначе заголовки идут рваным левым
          краем и лента перестаёт читаться сверху вниз одним движением */}
      <div className="pt-0.5 sm:min-w-[136px] sm:shrink-0">
        {signal.chip === null ? null : signal.tone === "neutral" ? (
          <Chip>{signal.chip}</Chip>
        ) : (
          <StatusChip tone={signal.tone as StatusTone}>{signal.chip}</StatusChip>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 font-medium text-[13.5px] text-text-1">
          <span className="min-w-0">{signal.title}</span>
          {signal.hint && <HelpTip>{signal.hint}</HelpTip>}
        </p>
        {signal.detail && (
          <p className="t-meta mt-0.5 text-text-3">{signal.detail}</p>
        )}
      </div>

      <SignalLink signal={signal} onOpenZones={onOpenZones} />
    </li>
  );
}

/**
 * Ссылка строки. «Зоны» — это режим того же экрана, поэтому кнопка,
 * а не Link: адрес страницы не меняется, меняется проекция.
 */
function SignalLink({
  signal,
  onOpenZones,
}: {
  signal: Signal;
  onOpenZones: () => void;
}) {
  const className =
    "t-meta shrink-0 self-start text-link underline-offset-4 hover:underline sm:self-center";

  if (signal.target === "zones") {
    return (
      <button type="button" onClick={onOpenZones} className={className}>
        Зоны →
      </button>
    );
  }
  if (signal.target === "debt") {
    return (
      <Link href="/debt" className={className}>
        Долг →
      </Link>
    );
  }
  if (signal.target === "wallets") {
    return (
      <Link href="/wallets" className={className}>
        Кошельки →
      </Link>
    );
  }
  return null;
}

/** Строка-вывод — по самому высокому уровню в ленте (§7: утверждение). */
function verdictFor(signals: Signal[], pending: boolean): string {
  const present = new Set<SignalSeverity>(signals.map((s) => s.severity));
  const tail = pending ? " Часть данных при этом ещё читается." : "";

  if (present.has("liquidation")) {
    return `Ликвидация — единственный сценарий, способный принудительно прервать накопление, поэтому она стоит первой.${tail}`;
  }
  if (present.has("level") || present.has("timer")) {
    return `Действие по стратегии предусмотрено верхней строкой — ниже наблюдения, которые ждут своего срока.${tail}`;
  }
  if (present.has("leverage")) {
    return `Срочного нет: плечо и ставки выравнивают при следующей операции.${tail}`;
  }
  return `Действий по стратегии нет — расходятся только данные.${tail}`;
}
