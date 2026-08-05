"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Segmented } from "@/components/dc/segmented";

/**
 * Разрез портфеля: «Активы» или «Зоны» — один и тот же капитал в двух
 * проекциях (docs/07 §10.1). Категория отвечает «в чём лежит» (BTC / ETH /
 * стейблы), зона — «какую задачу решает» (Growth / Yield / Stability).
 * Стейблкоины есть и в Stability, и в Yield, поэтому один разрез через
 * другой не выражается — это переключатель, а не два пункта навигации.
 *
 * Третий режим — «Сигналы»: не проекция капитала, а список того, что
 * требует действия. Он стоит тут же, потому что отвечает на тот же вопрос
 * с другой стороны — «что у меня есть» против «что с этим делать», — и
 * потому что своих данных не требует. Число в подписи и закреплённая
 * строка риска над любым режимом не дают ленте стать местом, куда надо
 * не забыть заглянуть.
 *
 * Выбор живёт в состоянии компонента, а адрес правится напрямую через
 * history.replaceState. Через роутер это делать нельзя: на статически
 * отрендеренной странице (в проде `/` именно такая) `router.replace`
 * с одним изменившимся query возвращал канонический адрес из кэша роутера,
 * то есть переписывал URL обратно на текущий — и переключатель залипал.
 * В dev баг не воспроизводился: там страница рендерится динамически.
 *
 * По существу это и не навигация: одни и те же данные, уже загруженные
 * на клиент, показываются в другой проекции. RSC-запрос на каждый щелчок
 * тут не нужен.
 *
 * `?view` в адресе остаётся, чтобы ссылку на нужный разрез можно было
 * отправить себе в заметку и чтобы он пережил перезагрузку. Приоритет
 * при открытии: явный параметр в URL → прошлый выбор из localStorage →
 * «Зоны» (главный вопрос стратегии — как капитал распределён по задачам,
 * а не в каких монетах он лежит).
 */

export type PortfolioView = "categories" | "zones" | "signals";

const DEFAULT_VIEW: PortfolioView = "zones";
const STORAGE_KEY = "portfolioView";

function isView(value: string | null): value is PortfolioView {
  return value === "categories" || value === "zones" || value === "signals";
}

export interface PortfolioViewState {
  view: PortfolioView;
  setView: (view: PortfolioView) => void;
}

export function usePortfolioView(): PortfolioViewState {
  const fromUrl = useSearchParams().get("view");

  /* Начальное значение считается один раз. Читать localStorage в рендере
     безопасно: поддерево живёт под <Suspense> и useSearchParams, поэтому
     на статической странице оно рендерится на клиенте, а не гидрируется
     из серверной разметки. */
  const [view, setViewState] = useState<PortfolioView>(() => {
    if (isView(fromUrl)) return fromUrl;
    if (typeof window === "undefined") return DEFAULT_VIEW;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isView(saved) ? saved : DEFAULT_VIEW;
  });

  const setView = useCallback((next: PortfolioView) => {
    setViewState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    // replaceState, а не pushState: щелчки по переключателю не должны
    // копиться в истории, «назад» обязан уводить со страницы
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?view=${next}`,
    );
  }, []);

  return { view, setView };
}

export function PortfolioViewSwitch({
  view,
  setView,
  signalCount,
}: PortfolioViewState & {
  /** Сколько строк требует внимания; 0 — подпись без числа. */
  signalCount?: number;
}) {
  // Значение в URL и localStorage остаётся «categories»: это ключ хранения,
  // а не подпись — переименование обнулило бы сохранённый выбор и ссылки
  const options: { value: PortfolioView; label: string }[] = [
    { value: "categories", label: "Активы" },
    { value: "zones", label: "Зоны" },
    {
      value: "signals",
      // Число прямо в подписи, а не отдельным значком: у переключателя
      // нет места под второй слой, а весь смысл счётчика — быть видимым
      // из режима, в котором сама лента не показана
      label: signalCount ? `Сигналы · ${signalCount}` : "Сигналы",
    },
  ];

  return (
    <Segmented
      options={options}
      value={view}
      onChange={setView}
      ariaLabel="Разрез портфеля"
    />
  );
}
