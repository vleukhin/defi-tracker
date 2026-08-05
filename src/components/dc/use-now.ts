"use client";

import { useEffect, useState } from "react";

/**
 * «Сейчас» с обновлением раз в минуту: обратный отсчёт 48 часов на карточке
 * LP должен идти, а не застывать на времени открытия экрана.
 *
 * Хук общий для экранов намеренно: таймер на карточке позиции и тот же
 * таймер в ленте сигналов обязаны идти по одному «сейчас», иначе соседние
 * блоки одного экрана показывают разное число часов.
 */
export function useNowMs(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
