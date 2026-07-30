"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Портфель" },
  { href: "/wallets", label: "Кошельки" },
  { href: "/targets", label: "Цели и записи" },
  { href: "/settings", label: "Настройки" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Навигация приложения: верхняя панель на десктопе,
 * нижняя фиксированная навигация на мобильных (mobile-first, экран 375px).
 */
export function AppNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Верхняя панель: бренд + ссылки (десктоп) + выход */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            DeFi Portfolio
          </Link>

          <nav className="hidden gap-1 sm:flex" aria-label="Основная навигация">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  isActive(pathname, item.href)
                    ? "bg-gray-100 font-medium text-gray-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            >
              Выйти
            </button>
          </form>
        </div>
      </header>

      {/* Нижняя навигация (мобильные) */}
      <nav
        aria-label="Основная навигация (мобильная)"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white sm:hidden"
      >
        <div className="grid grid-cols-4">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={`px-1 py-3 text-center text-xs ${
                isActive(pathname, item.href)
                  ? "font-semibold text-gray-900"
                  : "text-gray-500"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
