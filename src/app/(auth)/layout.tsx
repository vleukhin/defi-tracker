import { Logo } from "@/components/logo";

/** Layout страниц авторизации (ТЗ §5.5): логомарк lg + центрированная карточка. */
export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo size="lg" />
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-lg shadow-black/5 dark:shadow-none">
          {children}
        </div>
      </div>
    </div>
  );
}
