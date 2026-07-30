import type { Metadata } from "next";
import { HistoryScreen } from "@/components/history/history-screen";

export const metadata: Metadata = { title: "История" };

export default function HistoryPage() {
  return <HistoryScreen />;
}
