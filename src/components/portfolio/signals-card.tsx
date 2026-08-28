"use client";

import Link from "next/link";
import { Crosshair, Database, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { DcCard, SectionHead, Verdict } from "@/components/dc/card";
import { Chip, StatusChip, type StatusTone } from "@/components/dc/chip";
import { Disclosure } from "@/components/dc/disclosure";
import { HelpTip } from "@/components/dc/help-tip";
import {
  SIGNALS_VISIBLE,
  signalGroup,
  type Signal,
  type SignalKind,
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
  onRefresh,
}: {
  /** Требующие внимания: отмеченные выполненными сюда не входят. */
  signals: Signal[];
  /** Отмеченные выполненными — свёрнуты внизу, не исчезают насовсем. */
  acked: Signal[];
  /** Часть источников ещё читается: «действий нет» показывать нельзя. */
  pending: boolean;
  /** Сигналы позиций живут в разрезе «Зоны» — это смена проекции, не переход. */
  onOpenZones: () => void;
  /** Повторное чтение для сигналов, у которых переход ничего не исправляет. */
  onRefresh: () => void;
  /** fingerprint = null снимает отметку. */
  onAck: (signalKey: string, fingerprint: string | null) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const risk = signals.filter((signal) => signalGroup(signal.kind) === "risk");
  const strategy = signals.filter(
    (signal) => signalGroup(signal.kind) === "strategy",
  );
  const hygiene = signals.filter(
    (signal) => signalGroup(signal.kind) === "hygiene",
  );
  // Риск и действие стратегии не скрываются. Лимит применяется только к
  // диагностике: именно она может быть длинной и не требует решения сейчас.
  const hygieneLimit = Math.max(
    0,
    SIGNALS_VISIBLE - risk.length - strategy.length,
  );
  const visibleHygiene = expanded ? hygiene : hygiene.slice(0, hygieneLimit);
  const hidden = hygiene.length - visibleHygiene.length;

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

      <div>
        <SignalSection
          title="Риск"
          icon={<ShieldAlert />}
          signals={risk}
          onOpenZones={onOpenZones}
          onAck={onAck}
          onRefresh={onRefresh}
        />
        <SignalSection
          title="Действия стратегии"
          icon={<Crosshair />}
          signals={strategy}
          onOpenZones={onOpenZones}
          onAck={onAck}
          onRefresh={onRefresh}
        />
        <SignalSection
          title="Качество данных"
          icon={<Database />}
          signals={visibleHygiene}
          onOpenZones={onOpenZones}
          onAck={onAck}
          onRefresh={onRefresh}
        />
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="t-meta flex w-full items-center border-line border-t px-card py-2.5 text-left text-link underline-offset-4 pointer-coarse:min-h-11 hover:underline"
        >
          {`Ещё ${countLabel(hidden, "проблема данных", "проблемы данных", "проблем данных")}`}
        </button>
      )}

      <Verdict>{verdictFor(signals, pending)}</Verdict>
      <AckedBlock signals={acked} onAck={onAck} />
    </DcCard>
  );
}

function SignalSection({
  title,
  icon,
  signals,
  onOpenZones,
  onAck,
  onRefresh,
}: {
  title: string;
  icon: ReactNode;
  signals: Signal[];
  onOpenZones: () => void;
  onAck: (signalKey: string, fingerprint: string | null) => Promise<void>;
  onRefresh: () => void;
}) {
  if (signals.length === 0) return null;
  return (
    <section className="border-line border-b last:border-b-0">
      <h3 className="t-label flex items-center gap-2 bg-sunken px-card py-2.5">
        <span aria-hidden className="[&_svg]:size-3.5">{icon}</span>
        {title}
        <span className="font-mono text-[11px] text-text-3">{signals.length}</span>
      </h3>
      <ul className="grid gap-px bg-line">
        {signals.map((signal) => (
          <SignalRow
            key={signal.key}
            signal={signal}
            onOpenZones={onOpenZones}
            onAck={onAck}
            onRefresh={onRefresh}
          />
        ))}
      </ul>
    </section>
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
  if (signals.length === 0) return null;

  return (
    <Disclosure
      className="border-line border-t bg-sunken"
      title={
        <span className="t-meta text-text-3">
          {`Выполнено · ${signals.length}`}
        </span>
      }
    >
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
    </Disclosure>
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
const PINNED_ACTION_KINDS = new Set<SignalKind>([
  "gm-level",
  "gm-growth",
  "clmm-ready",
]);

export function RiskStrip({
  signals,
  onOpenSignals,
}: {
  signals: Signal[];
  onOpenSignals: () => void;
}) {
  const risk = signals.filter(
    (signal) =>
      signalGroup(signal.kind) === "risk" || PINNED_ACTION_KINDS.has(signal.kind),
  );
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
  onRefresh,
}: {
  signal: Signal;
  onOpenZones: () => void;
  /** Не передан — строка без кнопки отметки (закреплённая полоса риска). */
  onAck?: (signalKey: string, fingerprint: string | null) => Promise<void>;
  onRefresh?: () => void;
}) {
  return (
    <li className="relative flex flex-col gap-1.5 overflow-hidden bg-surface px-card py-3 pl-[22px] sm:flex-row sm:items-start sm:gap-3 sm:pl-[22px]">
      <span
        aria-hidden
        className={
          signal.tone === "loss"
            ? "absolute inset-y-0 left-0 w-0.5 bg-loss"
            : signal.tone === "warn"
              ? "absolute inset-y-0 left-0 w-0.5 bg-warn"
              : "absolute inset-y-0 left-0 w-0.5 bg-text-3"
        }
      />
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
        <SignalLink
          signal={signal}
          onOpenZones={onOpenZones}
          onRefresh={onRefresh}
        />
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
  onRefresh,
}: {
  signal: Signal;
  onOpenZones: () => void;
  onRefresh?: () => void;
}) {
  const className =
    "t-meta inline-flex shrink-0 items-center whitespace-nowrap text-link underline-offset-4 pointer-coarse:min-h-11 hover:underline";

  if (signal.target === "zones") {
    const anchor = zoneAnchor(signal.kind);
    return (
      <button
        type="button"
        onClick={() => {
          onOpenZones();
          window.setTimeout(() => {
            window.history.replaceState(
              window.history.state,
              "",
              `${window.location.pathname}?view=zones${anchor}`,
            );
            document.querySelector(anchor)?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }, 0);
        }}
        className={className}
      >
        {signalCta(signal.kind)} →
      </button>
    );
  }
  if (signal.target === "debt") {
    return (
      <Link href={debtHref(signal.kind)} className={className}>
        {signalCta(signal.kind)} →
      </Link>
    );
  }
  if (signal.target === "wallets") {
    return (
      <Link href="/wallets#sync-status" className={className}>
        {signalCta(signal.kind)} →
      </Link>
    );
  }
  if (
    onRefresh &&
    ["zones-unavailable", "refresh-failed", "prices-stale", "chains-unread"].includes(
      signal.kind,
    )
  ) {
    return (
      <button type="button" onClick={onRefresh} className={className}>
        Повторить обновление
      </button>
    );
  }
  return null;
}

function zoneAnchor(kind: SignalKind): string {
  if (kind === "free-unmarked") return "#free-funds";
  if (kind === "zones-mismatch") return "#zone-reconciliation";
  return "#positions";
}

function debtHref(kind: SignalKind): string {
  if (kind === "ltv-off-target") return "/debt#ltv-target";
  if (kind === "hf-below") return "/debt#debt-risk";
  return "/debt#debt-overview";
}

function signalCta(kind: SignalKind): string {
  const labels: Partial<Record<SignalKind, string>> = {
    "hf-below": "План защиты",
    "hf-unread": "Проверить HF",
    "hf-stale": "Проверить чтение",
    "debt-unread": "Проверить долг",
    "debt-unavailable": "Проверить долг",
    "gm-level": "Открыть уровень",
    "gm-growth": "Открыть уровень",
    "clmm-ready": "Открыть позицию",
    "clmm-waiting": "Открыть позицию",
    "clmm-unknown-since": "Проверить таймер",
    "ltv-off-target": "Открыть LTV",
    "rate-below-borrow": "Открыть ставку",
    "gm-split": "Открыть сплит",
    "zones-mismatch": "Открыть сверку",
    "positions-unmarked": "Разметить позиции",
    "positions-unpriced": "Проверить позиции",
    "free-unmarked": "Разметить балансы",
    "gm-no-entry": "Задать точку",
    "gm-no-price": "Открыть позицию",
    "borrow-rate-unread": "Проверить ставку",
    "chains-unread": "Проверить сети",
  };
  return labels[kind] ?? "Открыть";
}

/** Строка-вывод — по самому высокому уровню в ленте (§7: утверждение). */
function verdictFor(signals: Signal[], pending: boolean): string {
  const risk = signals.filter((signal) => signalGroup(signal.kind) === "risk").length;
  const strategy = signals.filter(
    (signal) => signalGroup(signal.kind) === "strategy",
  ).length;
  const hygiene = signals.filter(
    (signal) => signalGroup(signal.kind) === "hygiene",
  ).length;
  const tail = pending ? " Часть данных при этом ещё читается." : "";
  return `Риск: ${risk} · действия: ${strategy} · данные: ${hygiene}.${tail}`;
}
