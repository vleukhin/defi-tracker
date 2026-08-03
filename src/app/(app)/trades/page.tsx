import type { Metadata } from "next";
import { TradesManager } from "@/components/trades/trades-manager";

export const metadata: Metadata = { title: "Сделки" };

/**
 * Экран «Сделки». Заголовок живёт внутри TradesManager: кнопка «Новая
 * сделка» в шапке раскрывает форму и потому знает её состояние.
 */
export default function TradesPage() {
  return <TradesManager />;
}
