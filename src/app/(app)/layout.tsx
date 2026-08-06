import { AppNav } from "@/components/app-nav";
import { HfBadgeLive } from "@/components/debt/hf-badge";

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
      {/* Слот дизайн-кода §6: показатель, за которым следят ежедневно,
          не должен появляться лишь тогда, когда уже поздно */}
      <AppNav summary={<HfBadgeLive />} />
      <main className="page-shell flex flex-1 flex-col gap-4 px-4 py-6 sm:px-page">
        {children}
      </main>
    </div>
  );
}
