/**
 * Зоны health factor — единая шкала для экрана и для уведомлений.
 *
 * Лежит в универсальном модуле (без "server-only") по той же причине, что и
 * settings-defaults: границы нужны и клиенту (экран «Долг», индикатор в hero),
 * и серверу (крон мониторинга). Разъехавшись, они дали бы уведомление
 * «ниже порога» при зелёном числе на экране.
 *
 * Шкала опирается на три величины:
 *  * порог пользователя (user_settings.hf_warning_threshold, по умолчанию 1,5)
 *    — граница «спокойно / тревожно», настраивается;
 *  * 1,3 — уровень экстренного действия стратегии (docs/07 §7: «Если HF < 1.3
 *    при резком падении — продать часть GM и поднять HF примерно к 1.5»);
 *  * 1,2 — граница «тревожно / критично»: до ликвидации остаётся меньше шестой
 *    части стоимости залога.
 *
 * Порядок проверок — от худшего к лучшему, и это существенно: 1,3 и 1,2 живут
 * в стратегии, а не в настройке, поэтому HF 1,25 остаётся экстренным даже
 * у того, кто выставил себе порог 1,1. Зона при этом всегда монотонна по HF:
 * чем ниже HF, тем хуже зона, при любом пороге.
 */

/** Буфер над порогом, ниже которого HF считается «близким к порогу». */
export const HF_OK_MARGIN = 0.3;

/** Уровень экстренного действия стратегии (docs/07 §7). */
export const HF_URGENT = 1.3;

/** Ниже этого HF запас считается критическим — цвет loss (дизайн-код §5). */
export const HF_CRITICAL = 1.2;

/** Допуск сравнения: порог + 0,3 в float даёт 1,8000…02. */
const EPSILON = 1e-9;

/**
 * `none` — долга нет (контракт отдаёт uint256.max, у нас это null, «∞»).
 * Остальные зоны идут от спокойной к критической.
 */
export type HfZone = "none" | "calm" | "close" | "below" | "urgent" | "critical";

/**
 * Тяжесть зоны: больше — хуже. Сравнивать зоны напрямую нельзя (строки),
 * а сравнивать HF вместо зон — значит потерять смысл порога.
 */
export const HF_ZONE_RANK: Record<HfZone, number> = {
  none: 0,
  calm: 1,
  close: 2,
  below: 3,
  urgent: 4,
  critical: 5,
};

/** Зоны, в которых молчать нельзя: с них начинается риск ликвидации. */
export function isDangerZone(zone: HfZone): boolean {
  return HF_ZONE_RANK[zone] >= HF_ZONE_RANK.below;
}

export function hfZone(healthFactor: number | null, threshold: number): HfZone {
  if (healthFactor === null) return "none";
  if (healthFactor < HF_CRITICAL - EPSILON) return "critical";
  if (healthFactor < HF_URGENT - EPSILON) return "urgent";
  if (healthFactor < threshold - EPSILON) return "below";
  if (healthFactor < threshold + HF_OK_MARGIN - EPSILON) return "close";
  return "calm";
}

/**
 * Названия зон словами — цвет никогда не единственный признак, и в телеграме
 * цвета нет вовсе. Именительный падеж: строки идут после числа через тире
 * («HF 1,28 — ниже порога»).
 */
export const HF_ZONE_LABEL: Record<HfZone, string> = {
  none: "долга нет",
  calm: "с запасом",
  close: "близко к порогу",
  below: "ниже порога",
  urgent: "экстренный уровень",
  critical: "критично",
};
