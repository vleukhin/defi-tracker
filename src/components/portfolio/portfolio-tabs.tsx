"use client";

import { useState } from "react";
import { PortfolioDashboard } from "./portfolio-dashboard";
import { ZonesScreen } from "@/components/zones/zones-screen";
import { cn } from "@/lib/utils";

/**
 * Два разреза одного портфеля (Фаза 6).
 *
 * «Категории» — BTC / ETH / стейблы: в чем лежат деньги, доли и отклонения
 * от целей. «Зоны» — Growth / Yield / Stability: какую задачу решают, по
 * стратегии Capital Growth.
 *
 * Именно вкладками, а не двумя пунктами навигации: это одни и те же деньги,
 * и переключение между разрезами должно быть в одно нажатие. Восьмой пункт
 * нижнего бара на 375 px к тому же ужался бы до нечитаемого.
 */

const TABS = [
  { key: "categories", label: "Категории", title: "Портфель" },
  { key: "zones", label: "Зоны", title: "Зоны стратегии" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function PortfolioTabs() {
  const [tab, setTab] = useState<TabKey>("categories");
  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {active.title}
        </h1>

        <div
          role="tablist"
          aria-label="Разрез портфеля"
          className="inline-flex gap-1 rounded-lg bg-muted/60 p-1"
        >
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`ptab-${t.key}`}
                aria-selected={on}
                aria-controls={`ppanel-${t.key}`}
                onClick={() => setTab(t.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm outline-none transition-colors duration-120 ease-out focus-visible:ring-3 focus-visible:ring-ring/50",
                  on
                    ? "bg-background font-medium text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Панели монтируются по одной: каждая тянет свои запросы, держать
          неактивную в DOM значит гонять лишний трафик при обновлении */}
      <div
        role="tabpanel"
        id={`ppanel-${tab}`}
        aria-labelledby={`ptab-${tab}`}
        tabIndex={0}
        className="outline-none"
      >
        {tab === "categories" ? <PortfolioDashboard /> : <ZonesScreen />}
      </div>
    </div>
  );
}
