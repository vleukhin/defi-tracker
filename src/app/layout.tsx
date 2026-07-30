import type { Metadata } from "next";
import "./globals.css";
import { Footer } from "@/components/footer";

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
    <html lang="ru" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-gray-50 text-gray-900">
        <div className="flex flex-1 flex-col">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
