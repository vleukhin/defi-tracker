"use client";

import {
  ArrowLeftRight,
  ChartLine,
  ChartPie,
  Scale,
  Settings,
  Target,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Портфель", shortLabel: "Портфель", icon: ChartPie },
  {
    href: "/trades",
    label: "Сделки",
    shortLabel: "Сделки",
    icon: ArrowLeftRight,
  },
  // Фаза 3: снепшоты и графики динамики
  { href: "/history", label: "История", shortLabel: "История", icon: ChartLine },
  // Фаза 4: долг Aave и health factor
  { href: "/debt", label: "Долг", shortLabel: "Долг", icon: Scale },
  { href: "/wallets", label: "Кошельки", shortLabel: "Кошельки", icon: Wallet },
  // В шапке подпись сокращается до «Цели» (дизайн прототипа)
  { href: "/targets", label: "Цели", shortLabel: "Цели", icon: Target },
  {
    href: "/settings",
    label: "Настройки",
    shortLabel: "Настройки",
    icon: Settings,
  },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Шапка приложения (дизайн-код §6): высота 60px, sticky, фон с blur 14px.
 * Активный пункт — --bg-raised, неактивный — --text-2.
 *
 * Справа дизайн просит сумму портфеля и дневную дельту; шапка их не считает
 * сама, а принимает слотом — иначе она полезла бы в данные страницы.
 *
 * На узких ширинах верхнее меню уезжает в горизонтальный скролл, а не
 * дублируется нижним баром: семь пунктов в баре по 53px нарушают требование
 * hit-зоны ≥44px и подпись «Настройки» в них не помещается.
 */
export function AppNav({ summary }: { summary?: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-line border-b bg-[color-mix(in_srgb,var(--bg-canvas)_88%,transparent)] backdrop-blur-[14px]">
      <div className="page-shell flex h-header items-center gap-5 px-4 sm:gap-7 sm:px-page">
        <Link
          href="/"
          className="shrink-0 rounded-control outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo />
        </Link>

        <nav
          aria-label="Основная навигация"
          className="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-control px-[13px] py-[7px] text-[13.5px] outline-none transition-colors duration-120 ease-out focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "bg-raised font-medium text-text-1"
                    : "text-text-2 hover:bg-chip hover:text-text-1",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          {summary}
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-control px-2.5 py-[7px] text-[13.5px] text-text-2 outline-none transition-colors duration-120 ease-out hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Выйти
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
