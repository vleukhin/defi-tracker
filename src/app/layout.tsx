import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Footer } from "@/components/footer";
import { Toaster } from "@/components/ui/sonner";

/**
 * Типографика «Terminal Blue» (ТЗ §2.1): Inter — UI-текст,
 * JetBrains Mono — числа, адреса, код. Оба с кириллицей —
 * «п.п.», «нет цены», «мин назад» не выпадают в fallback.
 */
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});
const jbMono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-jbmono",
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
      className={`${inter.variable} ${jbMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
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
