"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import { Segmented } from "@/components/dc/segmented";

/**
 * Разрез портфеля: «Категории» или «Зоны» — один и тот же капитал в двух
 * проекциях (docs/07 §10.1). Категория отвечает «в чём лежит» (BTC / ETH /
 * стейблы), зона — «какую задачу решает» (Growth / Yield / Stability).
 * Стейблкоины есть и в Stability, и в Yield, поэтому один разрез через
 * другой не выражается — это переключатель, а не два пункта навигации.
 *
 * Источник истины — параметр `?view` в URL: ссылку на нужный разрез можно
 * отправить себе же в заметку, и кнопка «назад» работает. localStorage
 * только подставляет прошлый выбор, когда параметра нет.
 *
 * По умолчанию открываются «Зоны»: главный вопрос стратегии — как капитал
 * распределён по задачам, а не в каких монетах он лежит.
 */

export type PortfolioView = "categories" | "zones";

const DEFAULT_VIEW: PortfolioView = "zones";
const STORAGE_KEY = "portfolioView";

const VIEW_OPTIONS: { value: PortfolioView; label: string }[] = [
  { value: "categories", label: "Категории" },
  { value: "zones", label: "Зоны" },
];

function isView(value: string | null): value is PortfolioView {
  return value === "categories" || value === "zones";
}

export interface PortfolioViewState {
  view: PortfolioView;
  setView: (view: PortfolioView) => void;
}

export function usePortfolioView(): PortfolioViewState {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const fromUrl = params.get("view");
  const view = isView(fromUrl) ? fromUrl : DEFAULT_VIEW;

  /* Параметра нет — подставляем прошлый выбор правкой URL, а не состоянием:
     разметка первого рендера обязана совпасть с серверной, а localStorage
     на сервере не существует */
  useEffect(() => {
    if (isView(fromUrl)) return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isView(saved) && saved !== DEFAULT_VIEW) {
      router.replace(`${pathname}?view=${saved}`, { scroll: false });
    }
  }, [fromUrl, pathname, router]);

  const setView = useCallback(
    (next: PortfolioView) => {
      window.localStorage.setItem(STORAGE_KEY, next);
      router.replace(`${pathname}?view=${next}`, { scroll: false });
    },
    [pathname, router],
  );

  return { view, setView };
}

export function PortfolioViewSwitch({ view, setView }: PortfolioViewState) {
  return (
    <Segmented
      options={VIEW_OPTIONS}
      value={view}
      onChange={setView}
      ariaLabel="Разрез портфеля"
    />
  );
}
