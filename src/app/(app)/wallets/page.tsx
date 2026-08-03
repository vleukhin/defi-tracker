import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletsManager } from "@/components/wallets/wallets-manager";

export const metadata: Metadata = { title: "Кошельки" };

/**
 * «Кошельки» (README §7): адреса, что по ним читается и когда читалось
 * в последний раз. Заголовок и раскрываемая форма живут внутри менеджера —
 * primary-кнопка страницы и есть переключатель формы.
 *
 * TooltipProvider нужен для «?» в шапке таблицы: в layout приложения его нет.
 */
export default function WalletsPage() {
  return (
    <TooltipProvider>
      <WalletsManager />
    </TooltipProvider>
  );
}
