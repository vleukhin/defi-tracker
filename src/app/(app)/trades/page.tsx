import type { Metadata } from "next";
import { TradesManager } from "@/components/trades/trades-manager";

export const metadata: Metadata = { title: "Сделки" };

export default function TradesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Сделки</h1>
      <TradesManager />
    </div>
  );
}
