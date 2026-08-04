"use client";

import {
  ArrowLeftRight,
  ChartLine,
  ChartPie,
  LogOut,
  Menu,
  Scale,
  Settings,
  Target,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "radix-ui";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Портфель", icon: ChartPie },
  { href: "/trades", label: "Сделки", icon: ArrowLeftRight },
  // Фаза 3: снепшоты и графики динамики
  { href: "/history", label: "История", icon: ChartLine },
  // Фаза 4: долг Aave и health factor
  { href: "/debt", label: "Долг", icon: Scale },
  { href: "/wallets", label: "Кошельки", icon: Wallet },
  // В шапке подпись сокращается до «Цели» (дизайн прототипа)
  { href: "/targets", label: "Цели", icon: Target },
  { href: "/settings", label: "Настройки", icon: Settings },
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
 * Строка из семи пунктов вместе с логотипом и правым блоком требует ~865px,
 * поэтому ниже lg (1024px) она уезжает в выдвижную панель, а не в
 * горизонтальный скролл: скрытая полоса прокрутки не показывает, что за краем
 * что-то есть, и «Настройки» с «Целями» на телефоне были недостижимы вслепую.
 * Нижний таб-бар тут не подходит: семь пунктов по 53px нарушают hit-зону
 * ≥44px (§6), а подписи в них не помещаются.
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
          className="hidden min-w-0 flex-1 items-center gap-0.5 lg:flex"
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

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {summary}
          <ThemeToggle />
          <form action="/auth/signout" method="post" className="hidden lg:block">
            <button
              type="submit"
              className="rounded-control px-2.5 py-[7px] text-[13.5px] text-text-2 outline-none transition-colors duration-120 ease-out hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Выйти
            </button>
          </form>
          <MobileNav pathname={pathname} />
        </div>
      </div>
    </header>
  );
}

/**
 * Мобильная навигация: панель, выезжающая справа (сторона кнопки — палец не
 * перекрывает список, который открыл). Пункт — строка 48px с иконкой и полной
 * подписью: на ширину панели помещается любая, сокращать нечего.
 *
 * Диалог неуправляемый: каждый пункт обёрнут в Dialog.Close, поэтому панель
 * закрывается и при переходе на текущий маршрут, где pathname не меняется и
 * следить за ним было бы бесполезно.
 */
function MobileNav({ pathname }: { pathname: string }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Открыть меню"
          className="pointer-coarse:size-11 lg:hidden"
        >
          <Menu className="size-5" />
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 duration-120 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Content
          // Описания у панели нет: список пунктов говорит сам за себя,
          // без этого Radix предупреждает об отсутствующем aria-describedby
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[min(320px,85vw)] flex-col border-line-card border-l bg-surface shadow-(--shadow-pop) duration-150 outline-none data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right"
        >
          <div className="flex h-header shrink-0 items-center justify-between gap-3 border-line border-b pr-2 pl-4">
            <Dialog.Title className="t-h3">Меню</Dialog.Title>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Закрыть меню"
                className="pointer-coarse:size-11"
              >
                <X className="size-5" />
              </Button>
            </Dialog.Close>
          </div>

          <nav
            aria-label="Основная навигация"
            className="min-h-0 flex-1 overflow-y-auto p-2"
          >
            <ul className="flex flex-col gap-0.5">
              {NAV_ITEMS.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Dialog.Close asChild>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex h-12 items-center gap-3 rounded-control px-3 text-[15px] outline-none transition-colors duration-120 ease-out focus-visible:ring-3 focus-visible:ring-ring/50",
                          active
                            ? "bg-raised font-medium text-text-1"
                            : "text-text-2 hover:bg-chip hover:text-text-1",
                        )}
                      >
                        <item.icon
                          className={cn(
                            "size-[18px] shrink-0",
                            active ? "text-text-1" : "text-text-3",
                          )}
                        />
                        {item.label}
                      </Link>
                    </Dialog.Close>
                  </li>
                );
              })}
            </ul>
          </nav>

          <form
            action="/auth/signout"
            method="post"
            className="shrink-0 border-line border-t p-2 pb-[max(8px,env(safe-area-inset-bottom))]"
          >
            <button
              type="submit"
              className="flex h-12 w-full items-center gap-3 rounded-control px-3 text-[15px] text-text-2 outline-none transition-colors duration-120 ease-out hover:bg-chip hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <LogOut className="size-[18px] shrink-0 text-text-3" />
              Выйти
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
