"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Потянуть вниз — обновить. Единственный жест, которого мобильный
 * пользователь ждёт по умолчанию; до этого в приложении жестов не было
 * вовсе, и обновление стоило прицельного тапа по иконке в шапке.
 *
 * Намеренные ограничения, чтобы жест не мог сломать прокрутку:
 *  * preventDefault не вызывается никогда. Мы не отменяем ни скролл, ни
 *    резинку iOS — только читаем координаты. Худший исход отказа —
 *    обновление не сработает, а не «страница перестала листаться»;
 *  * жест начинается, только когда страница уже в самом верху, и
 *    отменяется, стоит ей сдвинуться вниз;
 *  * горизонтальные и диагональные движения отбрасываются: под пальцем
 *    могут быть таблица с горизонтальным скроллом или полоса чипов.
 *
 * Слушатели пассивные и висят на window: жест начинается в любом месте
 * экрана, а не только над этим блоком.
 */

/** Насколько нужно протянуть, чтобы обновление сработало (px). */
const THRESHOLD = 64;
/** Дальше индикатор не растёт. */
const MAX_PULL = 96;
/** Палец проходит вдвое больше, чем едет индикатор: тяга ощущается упругой. */
const RESISTANCE = 0.5;
/** Отклонение по горизонтали, после которого это уже не наш жест. */
const HORIZONTAL_SLOP = 12;

export function PullToRefresh({
  onRefresh,
  refreshing,
  children,
}: {
  onRefresh: () => void;
  /** Обновление уже идёт — жест не должен запускать второе. */
  refreshing: boolean;
  children: React.ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Решение о запуске принимается по ref, а не по state: иначе обработчики
  // пришлось бы переподписывать на каждый кадр движения пальца
  const pullRef = useRef(0);
  // Запись в ref идёт в эффекте, а не в рендере: рендер обязан быть чистым
  // (react-hooks/refs), а обработчикам нужно свежее значение без пересборки
  const refreshingRef = useRef(refreshing);
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    function reset() {
      start.current = null;
      pullRef.current = 0;
      setPull(0);
    }

    function onStart(event: TouchEvent) {
      if (refreshingRef.current || window.scrollY > 0 || event.touches.length !== 1) {
        start.current = null;
        return;
      }
      const touch = event.touches[0];
      start.current = { x: touch.clientX, y: touch.clientY };
    }

    function onMove(event: TouchEvent) {
      if (start.current === null) return;
      // Страница уехала вниз — это обычная прокрутка, а не тяга
      if (window.scrollY > 0) {
        reset();
        return;
      }
      const touch = event.touches[0];
      const dy = touch.clientY - start.current.y;
      const dx = Math.abs(touch.clientX - start.current.x);
      if (dy <= 0 || dx > HORIZONTAL_SLOP) {
        reset();
        return;
      }
      const next = Math.min(dy * RESISTANCE, MAX_PULL);
      pullRef.current = next;
      setPull(next);
    }

    function onEnd() {
      if (start.current === null) return;
      const reached = pullRef.current >= THRESHOLD;
      reset();
      if (reached && !refreshingRef.current) onRefresh();
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [onRefresh]);

  const armed = pull >= THRESHOLD;
  const active = pull > 0 || refreshing;

  return (
    <div className="relative">
      {/* Индикатор не двигает контент: сдвиг всей страницы на палец
          конфликтовал бы с резинкой iOS, которая едет одновременно */}
      <div
        aria-hidden={!refreshing}
        role="status"
        className={cn(
          "-top-1 pointer-events-none absolute inset-x-0 z-30 flex justify-center transition-opacity duration-120",
          active ? "opacity-100" : "opacity-0",
        )}
        style={{ transform: `translateY(${refreshing ? THRESHOLD / 2 : pull}px)` }}
      >
        <span
          className={cn(
            "flex items-center gap-2 rounded-pill border border-line-strong bg-raised px-3 py-1.5 text-[12.5px] shadow-(--shadow-pop)",
            armed || refreshing ? "text-text-1" : "text-text-3",
          )}
        >
          <RefreshCw
            aria-hidden
            className={cn("size-3.5", refreshing && "animate-spin")}
            style={
              refreshing
                ? undefined
                : { transform: `rotate(${(pull / MAX_PULL) * 270}deg)` }
            }
          />
          {refreshing
            ? "Обновление…"
            : armed
              ? "Отпустите — обновим"
              : "Потяните вниз"}
        </span>
      </div>
      {children}
    </div>
  );
}
