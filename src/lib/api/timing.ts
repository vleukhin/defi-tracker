import "server-only";

/**
 * Разметка времени внутри роута → заголовок `Server-Timing`.
 *
 * Нужна, чтобы не гадать, где уходит время: браузер показывает фазы в
 * DevTools → Network → Timing прямо у ответа, без логов и без деплоя
 * отдельного инструмента. Стоимость — одна строка в заголовках.
 *
 * Читается так: `auth` — проверка сессии, `db` — пакет выборок из Postgres,
 * `prices` — кэш цен, `build` — собственно счёт. Если сумма фаз мала, а
 * запрос всё равно долгий, время уходит вне функции (холодный старт,
 * очередь, дорога до региона).
 */
export interface RouteTimer {
  /** Закрывает очередную фазу и подписывает её. */
  mark: (name: string) => void;
  /** Заголовки ответа с накопленными фазами. */
  headers: () => Record<string, string>;
}

export function createTimer(): RouteTimer {
  const phases: string[] = [];
  let last = performance.now();

  return {
    mark: (name: string) => {
      const now = performance.now();
      phases.push(`${name};dur=${(now - last).toFixed(1)}`);
      last = now;
    },
    headers: () => ({ "Server-Timing": phases.join(", ") }),
  };
}
