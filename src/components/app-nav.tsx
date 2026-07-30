"use client";

import {
  ArrowLeftRight,
  ChartLine,
  ChartPie,
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
  { href: "/wallets", label: "Кошельки", shortLabel: "Кошельки", icon: Wallet },
  // В нижнем баре подпись сокращается до «Цели» (ТЗ §5.6.2)
  { href: "/targets", label: "Цели и записи", shortLabel: "Цели", icon: Target },
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
 * Навигация приложения (ТЗ §5.6): верхняя панель на всех брейкпоинтах,
 * нижняя фиксированная навигация с иконками на мобильных (< sm).
 */
export function AppNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Верхняя панель: логомарк + пилюли (≥ sm) + тема и выход */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link
            href="/"
            className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Logo size="sm" />
          </Link>

          <nav className="hidden gap-1 sm:flex" aria-label="Основная навигация">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm outline-none transition-colors duration-120 ease-out focus-visible:ring-3 focus-visible:ring-ring/50",
                  isActive(pathname, item.href)
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <ThemeToggle />
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground outline-none transition-colors duration-120 ease-out hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Выйти
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Нижняя навигация (мобильные): иконка 20px + подпись 11px */}
      <nav
        aria-label="Основная навигация (мобильная)"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
      >
        {/* Шесть пунктов на 375 px: подписи 10px, чтобы «Настройки» не резалось */}
        <div className="grid h-14 grid-cols-6">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 overflow-hidden outline-none transition-colors duration-120 ease-out focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="size-5" aria-hidden="true" />
                <span className="text-[10px] leading-tight">
                  {item.shortLabel}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
