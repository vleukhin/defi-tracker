import type { MetadataRoute } from "next";

/**
 * Манифест нужен ради standalone-режима: приложение открывают с телефона
 * по несколько раз в день, и адресная строка съедает ~90px первого экрана —
 * там, где по стратегии (docs/07 §4) должны помещаться количества BTC и ETH.
 *
 * Тема по умолчанию тёмная (ThemeProvider в layout.tsx), поэтому цвета
 * запуска берутся из тёмных токенов --bg-canvas / --bg-chip.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DeFi Portfolio Tracker",
    short_name: "Portfolio",
    description:
      "Трекер DeFi-портфеля: балансы кошельков (read-only), целевые пропорции и отклонения.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0c0f",
    theme_color: "#0a0c0f",
    lang: "ru",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
