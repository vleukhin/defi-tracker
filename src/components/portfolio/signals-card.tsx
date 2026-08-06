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
  acked,
  pending,
  onOpenZones,
  onAck,
}: {
  /** Требующие внимания: отмеченные выполненными сюда не входят. */
  signals: Signal[];
  /** Отмеченные выполненными — свёрнуты внизу, не исчезают насовсем. */
  acked: Signal[];
  /** Часть источников ещё читается: «действий нет» показывать нельзя. */
  pending: boolean;
  /** Сигналы позиций живут в разрезе «Зоны» — это смена проекции, не переход. */
  onOpenZones: () => void;
  /** fingerprint = null снимает отметку. */
  onAck: (signalKey: string, fingerprint: string | null) => Promise<void>;
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
        <AckedBlock signals={acked} onAck={onAck} />
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
            onAck={onAck}
          />
        ))}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="t-meta flex w-full items-center border-line border-t px-card py-2.5 text-left text-link underline-offset-4 pointer-coarse:min-h-11 hover:underline"
        >
          {`Ещё ${countLabel(hidden, "сигнал", "сигнала", "сигналов")}`}
        </button>
      )}

      <Verdict>{verdictFor(signals, pending)}</Verdict>
      <AckedBlock signals={acked} onAck={onAck} />
    </DcCard>
  );
}

/**
 * Отмеченное выполненным. Не исчезает насовсем: приложение не знает,
 * действительно ли операция сделана, — оно знает только, что так сказали.
 * Поэтому список сворачивается, а не удаляется, и отметку видно снять.
 */
function AckedBlock({
  signals,
  onAck,
}: {
  signals: Signal[];
  onAck: (signalKey: string, fingerprint: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  if (signals.length === 0) return null;

  return (
    <div className="border-line border-t bg-sunken">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="t-meta flex w-full items-center px-card py-2.5 text-left text-text-3 pointer-coarse:min-h-11 hover:text-text-2"
      >
        {`Отмечено выполненными · ${signals.length}`}
        <span className="ml-2 text-text-4">{open ? "скрыть" : "показать"}</span>
      </button>

      {open && (
        <ul className="grid gap-px bg-line">
          {signals.map((signal) => (
            <li
              key={signal.key}
              className="flex items-center gap-3 bg-sunken px-card py-2.5"
            >
              <span className="t-meta min-w-0 flex-1 text-text-3 line-through">
                {signal.title}
              </span>
              <button
                type="button"
                onClick={() => void onAck(signal.ackKey ?? "", null)}
                className="t-meta inline-flex shrink-0 items-center text-link underline-offset-4 pointer-coarse:min-h-11 hover:underline"
              >
                вернуть
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Строки, требующие действия, над любым режимом: если действие нужно,
 * узнать об этом надо не заходя на вкладку.
 *
 * Кроме риска ликвидации сюда попадают пройденные уровни GM (§5, §6) и
 * правило 48 часов по CLMM (§7) — то есть ровно те события, для которых
 * стратегия предусматривает конкретное действие сегодня. Раньше полоса
 * фильтровала только «ликвидацию», и «пробит −15%» жил одним счётчиком
 * в подписи сегмента: мелким текстом в правом верхнем углу.
 *
 * «Плечо» и «гигиена» остаются в ленте: первое правится при следующей
 * операции, второе говорит о данных, а не о позиции.
 */
const ACTIONABLE: SignalSeverity[] = ["liquidation", "level", "timer"];

export function RiskStrip({
  signals,
  onOpenSignals,
}: {
  signals: Signal[];
  onOpenSignals: () => void;
}) {
  const risk = signals.filter((s) => ACTIONABLE.includes(s.severity));
  if (risk.length === 0) return null;

  return (
    <DcCard as="section">
      <ul className="grid gap-px bg-line">
        {risk.map((signal) => (
          // Отметки здесь нет намеренно: полоса отвечает на вопрос «нужно ли
          // что-то делать», а отмечают сделанное в самой ленте — иначе
          // строка исчезала бы из-под пальца прямо на первом экране.
          // Разрез «Зоны» нужен уровням GM; строки риска ведут на «Долг»
          // и «Кошельки» и этот обработчик не используют
          <SignalRow
            key={signal.key}
            signal={signal}
            onOpenZones={onOpenSignals}
          />
        ))}
      </ul>
      <button
        type="button"
        onClick={onOpenSignals}
        className="t-meta w-full border-line border-t px-card py-2.5 text-left text-link underline-offset-4 hover:underline"
      >
        Открыть «Сигналы» →
      </button>
    </DcCard>
  );
}

function SignalRow({
  signal,
  onOpenZones,
  onAck,
}: {
  signal: Signal;
  onOpenZones: () => void;
  /** Не передан — строка без кнопки отметки (закреплённая полоса риска). */
  onAck?: (signalKey: string, fingerprint: string | null) => Promise<void>;
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

      <div className="flex shrink-0 items-center gap-3 self-start sm:self-center">
        {onAck && signal.ackKey && signal.ackFingerprint && (
          <button
            type="button"
            onClick={() =>
              void onAck(signal.ackKey as string, signal.ackFingerprint)
            }
            /* На тач-экране кнопка добирает высоту до 44px (§6); на десктопе
               остаётся чипом, чтобы не спорить с заголовком строки */
            className="t-meta whitespace-nowrap rounded-chip bg-chip px-2 py-1 text-text-2 hover:text-text-1 max-sm:min-h-11 max-sm:px-3"
          >
            Выполнено
          </button>
        )}
        <SignalLink signal={signal} onOpenZones={onOpenZones} />
      </div>
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
    "t-meta inline-flex shrink-0 items-center whitespace-nowrap text-link underline-offset-4 pointer-coarse:min-h-11 hover:underline";

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
