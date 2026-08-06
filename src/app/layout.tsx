import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Footer } from "@/components/footer";
import { Toaster } from "@/components/ui/sonner";

/**
 * Типографика дизайн-кода 1.0 (§3): IBM Plex Sans — весь интерфейс,
 * IBM Plex Mono — денежные суммы от 24px и точные количества токенов.
 * Оба с кириллицей — «нет цены», «мин назад», «залог» не выпадают в fallback.
 * Sans берётся переменным начертанием: дизайн-код использует вес 450,
 * которого нет среди статических файлов.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "DeFi Portfolio Tracker",
    template: "%s — DeFi Portfolio Tracker",
  },
  description:
    "Трекер DeFi-портфеля: балансы кошельков (read-only), целевые пропорции и отклонения.",
};

/**
 * Приложение открывают в основном с телефона.
 *
 * themeColor — те же значения, что у токена --bg-canvas в globals.css для
 * тёмной и светлой тем: без него адресная строка остаётся системно-серой
 * поверх тёмного холста.
 *
 * viewportFit: "cover" — обязателен для env(safe-area-inset-*): без него
 * отступы под home-indicator (app-nav, footer) всегда считаются нулём.
 *
 * Масштабирование не ограничиваем: maximum-scale/user-scalable=no ломают
 * доступность, а зум при фокусе лечится размером поля (16px), а не запретом.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0c0f" },
    { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: next-themes ставит класс темы на <html>
    // до гидрации (ТЗ §5.6.3) — без предупреждения о несовпадении.
    <html
      lang="ru"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        {/* Тема ставится и классом, и data-theme: токены дизайн-кода
            написаны под [data-theme], примитивы shadcn — под .dark */}
        <ThemeProvider
          attribute={["class", "data-theme"]}
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <div className="flex flex-1 flex-col">{children}</div>
          <Footer />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
