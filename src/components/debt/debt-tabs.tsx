"use client";

import { useState } from "react";
import { DebtScreen } from "./debt-screen";
import { LeverageScreen } from "./leverage-screen";
import { cn } from "@/lib/utils";

/**
 * Экран «Долг» с двумя вкладками (Фаза 5).
 *
 * «Левередж» сделан вкладкой, а не восьмым пунктом навигации: на 375 px
 * восьмая ячейка нижнего бара ужалась бы до ~46 px и подписи перестали бы
 * читаться. По смыслу это тоже одно место — сколько занято и что это дало.
 *
 * Переключатель — тот же сегментированный контрол, что в фильтрах сделок,
 * с ролью tablist: вкладки должны быть вкладками и для клавиатуры.
 */

const TABS = [
  { key: "debt", label: "Долг" },
  { key: "leverage", label: "Левередж" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function DebtTabs() {
  const [tab, setTab] = useState<TabKey>("debt");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Долг</h1>
      </div>

      <div
        role="tablist"
        aria-label="Разделы экрана «Долг»"
        className="inline-flex gap-1 rounded-lg bg-muted/60 p-1"
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={active}
              aria-controls={`panel-${t.key}`}
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm outline-none transition-colors duration-120 ease-out focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? "bg-background font-medium text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Панели монтируются по одной: обе тянут свои запросы, и держать
          неактивную в DOM значит гонять лишний трафик при каждом обновлении */}
      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
        className="outline-none"
      >
        {tab === "debt" ? <DebtScreen /> : <LeverageScreen />}
      </div>
    </div>
  );
}
