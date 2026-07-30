import { AppNav } from "@/components/app-nav";

/**
 * Layout авторизованной части приложения.
 * Доступ контролирует src/proxy.ts (редирект на /login без сессии).
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-1 flex-col">
      <AppNav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
