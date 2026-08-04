import { describe, expect, it } from "vitest";
import {
  evaluateHfAlert,
  FAST_DROP_CEILING_MARGIN,
  HF_HYSTERESIS,
  REPEAT_MS,
  STALE_AFTER_MS,
  type HfAlertState,
} from "./hf";

/**
 * Правила уведомлений проверяются только здесь: на живом рынке их не
 * воспроизвести, а ошибка либо молчит при падении, либо шлёт сообщение
 * каждые пятнадцать минут.
 */

const NOW = Date.parse("2026-08-03T12:00:00.000Z");
const THRESHOLD = 1.5;

/** Наблюдение «прочитано только что». */
function fresh(healthFactor: number | null, agoMs = 60_000) {
  return {
    healthFactor,
    checkedAt: new Date(NOW - agoMs).toISOString(),
  };
}

function state(
  zone: HfAlertState["zone"],
  notifiedHf: number | null,
  agoMs = 0,
): HfAlertState {
  return {
    zone,
    notifiedHf,
    notifiedAt: new Date(NOW - agoMs).toISOString(),
  };
}

function run(
  prev: HfAlertState | null,
  observation: { healthFactor: number | null; checkedAt: string | null },
  threshold = THRESHOLD,
) {
  return evaluateHfAlert({ prev, observation, threshold, now: NOW });
}

describe("первое знакомство", () => {
  it("спокойную зону запоминает молча", () => {
    const { event, nextState } = run(null, fresh(2.4));
    expect(event).toBeNull();
    // Точка отсчёта нужна уже сейчас: без неё правило «упал на 10%»
    // не от чего считать
    expect(nextState).toMatchObject({ zone: "calm", notifiedHf: 2.4 });
  });

  it("об опасной зоне сообщает сразу", () => {
    const { event, nextState } = run(null, fresh(1.28));
    expect(event).toMatchObject({
      kind: "zone-down",
      zone: "urgent",
      previousZone: null,
    });
    expect(nextState?.zone).toBe("urgent");
  });

  it("кошелёк без долга не тревожит", () => {
    const { event, nextState } = run(null, fresh(null));
    expect(event).toBeNull();
    expect(nextState).toMatchObject({ zone: "none", notifiedHf: null });
  });

  it("кошелёк, который ни разу не читался, не даёт события", () => {
    expect(run(null, { healthFactor: null, checkedAt: null })).toEqual({
      event: null,
      nextState: null,
    });
  });
});

describe("уход вниз", () => {
  it("сообщает при переходе в более низкую зону", () => {
    const { event } = run(state("calm", 2.1), fresh(1.62));
    expect(event).toMatchObject({
      kind: "zone-down",
      zone: "close",
      previousZone: "calm",
      previousHf: 2.1,
    });
  });

  it("перешагивание через зону — одно событие с итоговой зоной", () => {
    const { event } = run(state("calm", 2.1), fresh(1.15));
    expect(event).toMatchObject({ kind: "zone-down", zone: "critical" });
  });

  it("появление долга в спокойной зоне не повод для сообщения", () => {
    const { event, nextState } = run(state("none", null), fresh(3.2));
    expect(event).toBeNull();
    expect(nextState).toMatchObject({ zone: "calm", notifiedHf: 3.2 });
  });

  it("появление долга сразу в опасной зоне — сообщение", () => {
    const { event } = run(state("none", null), fresh(1.4));
    expect(event).toMatchObject({ kind: "zone-down", zone: "below" });
  });
});

describe("возврат вверх и гистерезис", () => {
  it("возврат без запаса не засчитывается", () => {
    // Граница calm при пороге 1,5 — это 1,8; 1,81 стоит на ней
    const { event, nextState } = run(state("close", 1.7), fresh(1.81));
    expect(event).toBeNull();
    expect(nextState).toBeNull();
  });

  it("возврат с запасом даёт одно сообщение", () => {
    const { event } = run(state("close", 1.7), fresh(1.8 + HF_HYSTERESIS + 0.01));
    expect(event).toMatchObject({
      kind: "zone-up",
      zone: "calm",
      previousZone: "close",
    });
  });

  it("дребезг у границы не порождает потока сообщений", () => {
    // Тот же HF туда-обратно вокруг порога: вниз — событие, вверх — тишина
    const down = run(state("close", 1.82), fresh(1.49));
    expect(down.event).toMatchObject({ kind: "zone-down", zone: "below" });

    const back = run(state("below", 1.49), fresh(1.51));
    expect(back.event).toBeNull();
  });

  it("погашенный долг — событие возврата без проверки запаса", () => {
    const { event, nextState } = run(state("critical", 1.1), fresh(null));
    expect(event).toMatchObject({ kind: "zone-up", zone: "none" });
    expect(nextState).toMatchObject({ zone: "none", notifiedHf: null });
  });
});

describe("резкое падение внутри зоны", () => {
  it("срабатывает от точки последнего сообщения, а не наблюдения", () => {
    const { event } = run(state("below", 1.48), fresh(1.33));
    expect(event).toMatchObject({ kind: "fast-drop", zone: "below" });
    expect(event?.dropShare).toBeGreaterThanOrEqual(0.1);
  });

  it("падение меньше 10% молчит", () => {
    expect(run(state("below", 1.45), fresh(1.36)).event).toBeNull();
  });

  it("не работает там, где до порога ещё далеко", () => {
    // −10% от 8,0 — это 7,2: формально резко, по сути ничего не значит
    expect(run(state("calm", 8), fresh(7.2)).event).toBeNull();
  });

  it("работает у самого потолка правила", () => {
    const ceiling = THRESHOLD + FAST_DROP_CEILING_MARGIN;
    // Падение на 17% с остановкой чуть ниже потолка — правило действует
    const { event } = run(state("calm", ceiling * 1.2), fresh(ceiling - 0.01));
    expect(event).toMatchObject({ kind: "fast-drop" });
  });

  it("медленное сползание накапливается и в итоге срабатывает", () => {
    // Шаги по 4% — каждый по отдельности молчит, но состояние не сдвигается,
    // поэтому третий шаг перебирает 10% относительно последнего сообщения
    let prev = state("below", 1.45);
    const steps = [1.392, 1.336, 1.305];
    const events = steps.map((hf) => {
      const decision = run(prev, fresh(hf));
      if (decision.nextState) prev = decision.nextState;
      return decision.event?.kind ?? null;
    });
    expect(events).toEqual([null, null, "fast-drop"]);
  });
});

describe("повторы в опасной зоне", () => {
  it("ниже порога напоминает раз в шесть часов", () => {
    const justSent = run(state("below", 1.45, 60_000), fresh(1.45));
    expect(justSent.event).toBeNull();

    const later = run(state("below", 1.45, REPEAT_MS.below!), fresh(1.45));
    expect(later.event).toMatchObject({ kind: "repeat", zone: "below" });
  });

  it("критично напоминает раз в час", () => {
    const later = run(state("critical", 1.15, REPEAT_MS.critical!), fresh(1.15));
    expect(later.event).toMatchObject({ kind: "repeat", zone: "critical" });
  });

  it("в спокойных зонах повторов нет", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(run(state("calm", 2.4, week), fresh(2.4)).event).toBeNull();
    expect(run(state("close", 1.7, week), fresh(1.7)).event).toBeNull();
  });
});

describe("слепота", () => {
  it("сообщает, когда HF не читается дольше порога", () => {
    const { event, nextState } = run(
      state("below", 1.45),
      fresh(1.45, STALE_AFTER_MS + 60_000),
    );
    expect(event).toMatchObject({ kind: "stale", previousZone: "below" });
    // Точка отсчёта падения переносится: нового чтения не было
    expect(nextState).toMatchObject({ zone: "stale", notifiedHf: 1.45 });
  });

  it("сообщает один раз, без повторов", () => {
    const { event, nextState } = run(
      state("stale", 1.45),
      fresh(1.45, STALE_AFTER_MS * 3),
    );
    expect(event).toBeNull();
    expect(nextState).toBeNull();
  });

  it("молчит про кошелёк без долга", () => {
    const { event } = run(state("none", null), fresh(null, STALE_AFTER_MS * 2));
    expect(event).toBeNull();
  });

  it("восстановление чтения — одно сообщение с текущим значением", () => {
    const { event, nextState } = run(state("stale", 1.45), fresh(1.62));
    expect(event).toMatchObject({
      kind: "stale-recovered",
      zone: "close",
      previousZone: "stale",
    });
    expect(nextState).toMatchObject({ zone: "close", notifiedHf: 1.62 });
  });
});

describe("порог пользователя", () => {
  it("двигает границы зон", () => {
    // Одно и то же падение 3,0 → 1,9 читается по-разному: при пороге 2,5 это
    // уход ниже порога, при 1,5 — резкое падение внутри спокойной зоны
    expect(run(state("calm", 3), fresh(1.9), 2.5).event).toMatchObject({
      kind: "zone-down",
      zone: "below",
    });
    expect(run(state("calm", 3), fresh(1.9), 1.5).event).toMatchObject({
      kind: "fast-drop",
      zone: "calm",
    });
  });

  it("уровни стратегии не зависят от порога", () => {
    // Порог 1,1 ниже уровня 1,3, но 1,25 остаётся экстренным
    const { event } = run(state("calm", 2), fresh(1.25), 1.1);
    expect(event).toMatchObject({ kind: "zone-down", zone: "urgent" });
  });
});

describe("состояние без события", () => {
  it("не сдвигает точку отсчёта", () => {
    expect(run(state("below", 1.45), fresh(1.44))).toEqual({
      event: null,
      nextState: null,
    });
  });
});
