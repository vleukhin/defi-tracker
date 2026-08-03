import type { HfAlertEvent } from "@/lib/alerts/hf";
import { chainLabel, tableNumber, truncateAddress } from "@/lib/format";
import { HF_ZONE_LABEL, HF_URGENT, type HfZone } from "@/lib/hf-zones";
import type { OutgoingMessage } from "./types";

/**
 * Тексты уведомлений.
 *
 * Правила записи чисел те же, что на экране (дизайн-код §4): десятичная
 * запятая, минус U+2212, проценты без лишних знаков. Эмодзи нет — их нет
 * во всём интерфейсе, и в сообщении о риске ликвидации они особенно
 * неуместны. Тон — утверждение, а не инструкция (§7): сообщение говорит,
 * что произошло, а решение остаётся за владельцем.
 *
 * Единственное исключение — экстренный уровень: там стратегия сама
 * называет действие (docs/07 §7), и повторить её словами полезнее, чем
 * заставлять вспоминать документ в три часа ночи.
 */

/** Минус — символ U+2212, как во всём интерфейсе. */
const MINUS = "−";

export interface HfMessageContext {
  event: HfAlertEvent;
  chain: string;
  walletAddress: string;
  walletLabel: string | null;
  threshold: number;
}

/** «1,68» / «∞» — HF словами для канала без цвета. */
function hf(value: number | null): string {
  return value === null ? "∞" : tableNumber(value, 2);
}

/** «Основной (0x1234…abcd) · Arbitrum» — где именно. */
function whereLine(ctx: HfMessageContext): string {
  const address = truncateAddress(ctx.walletAddress);
  const wallet =
    ctx.walletLabel !== null && ctx.walletLabel.trim() !== ""
      ? `${ctx.walletLabel} (${address})`
      : address;
  return `${wallet} · ${chainLabel(ctx.chain)}`;
}

/** Заголовок: что произошло, одной строкой. */
function title(ctx: HfMessageContext): string {
  const { event } = ctx;
  const zone = event.zone;

  switch (event.kind) {
    case "zone-down":
      return zone === "critical"
        ? `Health factor критический: ${hf(event.healthFactor)}`
        : `Health factor упал: ${hf(event.healthFactor)}`;
    case "fast-drop":
      return `Health factor резко упал: ${hf(event.healthFactor)}`;
    case "repeat":
      return `Health factor всё ещё ${hf(event.healthFactor)}`;
    case "zone-up":
      return zone === "none"
        ? "Долг погашен — health factor не ограничен"
        : `Health factor восстановился: ${hf(event.healthFactor)}`;
    case "stale":
      return "Health factor не читается";
    case "stale-recovered":
      return `Health factor снова читается: ${hf(event.healthFactor)}`;
  }
}

/** Строка-вывод: что это значит. Для экстренного уровня — мера из стратегии. */
function verdict(zone: HfZone, threshold: number): string | null {
  switch (zone) {
    case "critical":
      return `До ликвидации меньше шестой части стоимости залога. По стратегии: продать часть GM и поднять HF к ${tableNumber(1.5, 2)}.`;
    case "urgent":
      return `Уровень экстренного действия (${tableNumber(HF_URGENT, 2)}). По стратегии: продать часть GM и поднять HF к ${tableNumber(1.5, 2)}.`;
    case "below":
      return `Ниже порога ${tableNumber(threshold, 2)} — запас прочности сократился.`;
    case "close":
      return `До порога ${tableNumber(threshold, 2)} осталось немного.`;
    default:
      return null;
  }
}

export function buildHfMessage(ctx: HfMessageContext): OutgoingMessage {
  const { event, threshold } = ctx;
  const lines: string[] = [whereLine(ctx)];

  if (event.kind === "stale") {
    const hours = Math.floor((event.staleForMs ?? 0) / (60 * 60 * 1000));
    lines.push(
      `Последнее удачное чтение — ${hours} ч назад; последнее известное значение ${hf(event.previousHf)}.`,
      "Пока чтение не восстановится, изменения HF остаются незамеченными.",
    );
    return { title: title(ctx), lines };
  }

  // Было → стало: без предыдущего значения число не с чем сравнить
  if (event.previousHf !== null && event.healthFactor !== null) {
    const dropPart =
      event.dropShare !== undefined
        ? ` (${MINUS}${tableNumber(event.dropShare * 100, 1)}%)`
        : "";
    lines.push(
      `Было ${hf(event.previousHf)} → стало ${hf(event.healthFactor)}${dropPart}`,
    );
  }

  if (event.zone !== "stale") {
    lines.push(
      `Зона: ${HF_ZONE_LABEL[event.zone]} · порог ${tableNumber(threshold, 2)}`,
    );
    const note = verdict(event.zone, threshold);
    if (note !== null) lines.push(note);
  }

  return { title: title(ctx), lines };
}

/** Тестовое сообщение из настроек: проверка, что канал доносит текст. */
export function buildTestMessage(): OutgoingMessage {
  return {
    title: "Проверка канала",
    lines: [
      "Уведомления о health factor будут приходить сюда.",
      "Это тестовое сообщение — ничего не произошло.",
    ],
  };
}

/** Приветствие после успешной привязки — подтверждение, что чат правильный. */
export function buildLinkedMessage(): OutgoingMessage {
  return {
    title: "Канал подключён",
    lines: [
      "Сюда будут приходить предупреждения о health factor:",
      "уход ниже порога, экстренный уровень и восстановление.",
    ],
  };
}
