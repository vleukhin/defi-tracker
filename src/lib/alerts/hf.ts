import {
  HF_ZONE_RANK,
  hfZone,
  isDangerZone,
  type HfZone,
} from "@/lib/hf-zones";

/**
 * Правила уведомлений по health factor: когда наблюдение стоит сообщения.
 *
 * Чистая функция без I/O — на вход прошлое состояние и одно наблюдение,
 * на выход решение. Это единственное место, где живёт ответ на вопрос
 * «что считать значимым изменением», и оно тестируется офлайн: проверять
 * такие правила на живом рынке невозможно, а ошибка в них либо молчит
 * при падении, либо будит владельца каждые пятнадцать минут.
 *
 * Три свойства, ради которых всё устроено именно так:
 *
 *  1. Состояние хранит точку ПОСЛЕДНЕГО СООБЩЕНИЯ, а не последнего
 *     наблюдения. Иначе правило «упал на 10%» мерило бы шаг между соседними
 *     прогонами: HF, сползающий по проценту за прогон, дошёл бы до
 *     ликвидации, ни разу не дав события.
 *  2. Возврат вверх требует запаса (гистерезис). HF, стоящий ровно на
 *     границе, иначе выдавал бы «ниже порога / восстановлено» каждые
 *     пятнадцать минут — а такой поток перестают читать после второго дня.
 *  3. Слепота — состояние, а не пробел. Если чтение сети перестало
 *     проходить, молчание неотличимо от «всё хорошо», поэтому длительная
 *     слепота сама по себе повод сообщить.
 *
 * За один прогон по (кошелёк, сеть) выдаётся максимум одно событие: две
 * причины одного и того же падения — это два сообщения об одном событии.
 */

/** Насколько HF должен превысить границу зоны, чтобы возврат засчитался. */
export const HF_HYSTERESIS = 0.05;

/** Падение относительно последней отправленной точки, считающееся резким. */
export const FAST_DROP_SHARE = 0.1;

/**
 * Потолок правила резкого падения: выше порог + 1,0 оно не работает.
 * Падение с 8,0 до 7,2 формально те же 10%, но до порога всё ещё
 * шестикратный запас, и сообщение о нём — шум.
 */
export const FAST_DROP_CEILING_MARGIN = 1;

/** Чтение старше этого — слепота (шесть часов = 24 пропущенных прогона). */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Как часто напоминать, пока HF остаётся в опасной зоне. Зоны спокойнее
 * `below` в таблице отсутствуют намеренно: там повторять нечего.
 */
export const REPEAT_MS: Partial<Record<HfZone, number>> = {
  below: 6 * 60 * 60 * 1000,
  urgent: 60 * 60 * 1000,
  critical: 60 * 60 * 1000,
};

/** Зона последнего сообщения плюс особое состояние «HF не читается». */
export type HfAlertZone = HfZone | "stale";

export interface HfAlertState {
  zone: HfAlertZone;
  /**
   * HF в момент последнего сообщения; null = долга тогда не было.
   * Исключение — первое знакомство с позицией: там сообщения могло не быть,
   * но точка отсчёта для правила «упал на 10%» нужна уже тогда.
   */
  notifiedHf: number | null;
  /** ISO-момент последнего сообщения (или первого знакомства). */
  notifiedAt: string;
}

export interface HfObservation {
  /** null = долга нет («∞»). */
  healthFactor: number | null;
  /** ISO-момент последнего удачного чтения; null = не читалось ни разу. */
  checkedAt: string | null;
}

export type HfAlertEventKind =
  /** Ушли в более низкую зону — включая первое знакомство в опасной зоне. */
  | "zone-down"
  /** Вернулись в зону получше (в том числе долг погашен). */
  | "zone-up"
  /** Резкое падение внутри зоны. */
  | "fast-drop"
  /** Напоминание: всё ещё в опасной зоне. */
  | "repeat"
  /** HF не читается дольше STALE_AFTER_MS. */
  | "stale"
  /** Чтение восстановилось. */
  | "stale-recovered";

export interface HfAlertEvent {
  kind: HfAlertEventKind;
  zone: HfAlertZone;
  /** null у первого знакомства. */
  previousZone: HfAlertZone | null;
  healthFactor: number | null;
  /** HF предыдущего сообщения — от него считается падение. */
  previousHf: number | null;
  /** Доля падения относительно previousHf; только у fast-drop. */
  dropShare?: number;
  /** Момент чтения, к которому относится HF. */
  checkedAt: string | null;
  /** Сколько времени HF не читается; только у stale. */
  staleForMs?: number;
}

export interface HfAlertDecision {
  /** null = сообщать не о чем. */
  event: HfAlertEvent | null;
  /** null = состояние трогать не нужно (наблюдение ничего не изменило). */
  nextState: HfAlertState | null;
}

const SILENT: HfAlertDecision = { event: null, nextState: null };

export interface EvaluateHfAlertInput {
  /** Состояние из hf_alert_state; null = позицию видим впервые. */
  prev: HfAlertState | null;
  observation: HfObservation;
  /** Порог пользователя (user_settings.hf_warning_threshold). */
  threshold: number;
  /** Момент прогона в миллисекундах — инъекция вместо Date.now(). */
  now: number;
}

export function evaluateHfAlert({
  prev,
  observation,
  threshold,
  now,
}: EvaluateHfAlertInput): HfAlertDecision {
  const { healthFactor, checkedAt } = observation;
  const nowIso = new Date(now).toISOString();

  // Не читалось ни разу: наблюдения нет, а «нет данных» — не событие.
  // Так выглядит только что добавленный кошелёк, и молчать про него верно.
  if (checkedAt === null) return SILENT;

  const checkedMs = Date.parse(checkedAt);
  const staleForMs = Number.isNaN(checkedMs) ? 0 : now - checkedMs;

  if (staleForMs > STALE_AFTER_MS) {
    // Про слепоту сообщаем один раз и только там, где было что терять:
    // кошелёк без займа не заслуживает тревоги за несвежий «∞».
    if (prev === null || prev.zone === "stale" || prev.zone === "none") {
      return SILENT;
    }
    return {
      event: {
        kind: "stale",
        zone: "stale",
        previousZone: prev.zone,
        healthFactor,
        previousHf: prev.notifiedHf,
        checkedAt,
        staleForMs,
      },
      // Точка отсчёта падения переносится как есть: чтения не было,
      // а значит и нового опорного HF взяться неоткуда.
      nextState: { zone: "stale", notifiedHf: prev.notifiedHf, notifiedAt: nowIso },
    };
  }

  const zone = hfZone(healthFactor, threshold);

  // Первое знакомство: спокойную зону запоминаем молча, опасную — сообщаем.
  // Молчать о том, что HF уже плохой, нельзя: владелец узнал бы об этом
  // только при следующем ухудшении.
  if (prev === null) {
    const next: HfAlertState = {
      zone,
      notifiedHf: healthFactor,
      notifiedAt: nowIso,
    };
    if (!isDangerZone(zone)) return { event: null, nextState: next };
    return {
      event: {
        kind: "zone-down",
        zone,
        previousZone: null,
        healthFactor,
        previousHf: null,
        checkedAt,
      },
      nextState: next,
    };
  }

  // Чтение восстановилось. Одно сообщение с текущим значением — и дальше
  // обычные правила: слать следом ещё и «ниже порога» значило бы два
  // сообщения об одном и том же состоянии.
  if (prev.zone === "stale") {
    return {
      event: {
        kind: "stale-recovered",
        zone,
        previousZone: "stale",
        healthFactor,
        previousHf: prev.notifiedHf,
        checkedAt,
      },
      nextState: { zone, notifiedHf: healthFactor, notifiedAt: nowIso },
    };
  }

  const prevZone = prev.zone;
  const rank = HF_ZONE_RANK[zone];
  const prevRank = HF_ZONE_RANK[prevZone];

  if (rank > prevRank) {
    // Долг появился там, где его не было: событие само по себе ожидаемое
    // (заём — осознанное действие), поэтому сообщаем, только если сразу
    // оказались в опасной зоне.
    if (prevZone === "none" && !isDangerZone(zone)) {
      return {
        event: null,
        nextState: { zone, notifiedHf: healthFactor, notifiedAt: nowIso },
      };
    }
    return {
      event: {
        kind: "zone-down",
        zone,
        previousZone: prevZone,
        healthFactor,
        previousHf: prev.notifiedHf,
        checkedAt,
      },
      nextState: { zone, notifiedHf: healthFactor, notifiedAt: nowIso },
    };
  }

  if (rank < prevRank) {
    // Гистерезис: возврат засчитывается, только если зона осталась лучше
    // прежней и с запасом HF_HYSTERESIS вниз. Долг погашен (HF = null) —
    // проверять нечего, «∞» на границе не стоит.
    if (healthFactor !== null) {
      const confirmed = hfZone(healthFactor - HF_HYSTERESIS, threshold);
      if (HF_ZONE_RANK[confirmed] >= prevRank) return SILENT;
    }
    return {
      event: {
        kind: "zone-up",
        zone,
        previousZone: prevZone,
        healthFactor,
        previousHf: prev.notifiedHf,
        checkedAt,
      },
      nextState: { zone, notifiedHf: healthFactor, notifiedAt: nowIso },
    };
  }

  // Зона та же. Сначала резкое падение — оно срочнее напоминания по таймеру.
  if (
    healthFactor !== null &&
    prev.notifiedHf !== null &&
    prev.notifiedHf > 0 &&
    healthFactor < threshold + FAST_DROP_CEILING_MARGIN
  ) {
    const dropShare = (prev.notifiedHf - healthFactor) / prev.notifiedHf;
    if (dropShare >= FAST_DROP_SHARE) {
      return {
        event: {
          kind: "fast-drop",
          zone,
          previousZone: prevZone,
          healthFactor,
          previousHf: prev.notifiedHf,
          dropShare,
          checkedAt,
        },
        nextState: { zone, notifiedHf: healthFactor, notifiedAt: nowIso },
      };
    }
  }

  const repeatAfter = REPEAT_MS[zone];
  if (repeatAfter !== undefined) {
    const since = Date.parse(prev.notifiedAt);
    if (!Number.isNaN(since) && now - since >= repeatAfter) {
      return {
        event: {
          kind: "repeat",
          zone,
          previousZone: prevZone,
          healthFactor,
          previousHf: prev.notifiedHf,
          checkedAt,
        },
        nextState: { zone, notifiedHf: healthFactor, notifiedAt: nowIso },
      };
    }
  }

  // Ничего не произошло. Состояние НЕ трогаем: перезаписав notifiedHf
  // текущим значением, мы сдвинули бы точку отсчёта правила «упал на 10%»
  // и потеряли бы медленное сползание.
  return SILENT;
}
