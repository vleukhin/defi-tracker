import { AppNav } from "@/components/app-nav";

/**
 * Layout авторизованной части приложения.
 * Доступ контролирует src/proxy.ts (редирект на /login без сессии).
 *
 * Сетка дизайн-кода (§6): контент 1120px по центру, поля страницы 28px,
 * между блоками 16px. «Настройки» сужают контент до 840px у себя на месте.
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-1 flex-col">
      <AppNav />
      <main className="page-shell flex flex-1 flex-col gap-4 px-4 py-6 sm:px-page">
        {children}
      </main>
    </div>
  );
}
