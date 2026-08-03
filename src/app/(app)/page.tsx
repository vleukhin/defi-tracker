import type { Metadata } from "next";
import { Suspense } from "react";
import { PortfolioScreen } from "@/components/portfolio/portfolio-screen";

export const metadata: Metadata = { title: "Портфель" };

/**
 * Разрез портфеля живёт в `?view=zones|categories`, а useSearchParams
 * переводит поддерево на клиентский рендер — Suspense обязателен, иначе
 * пререндер всей страницы откладывается до гидрации.
 */
export default function DashboardPage() {
  return (
    <Suspense>
      <PortfolioScreen />
    </Suspense>
  );
}
