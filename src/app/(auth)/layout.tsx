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
        {/* Тени у карточек нет (дизайн-код §9): глубину задаёт тон поверхности */}
        <div className="rounded-card border border-line-card bg-surface p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
