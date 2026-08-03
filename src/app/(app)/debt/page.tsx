import type { Metadata } from "next";
import { DebtScreen } from "@/components/debt/debt-screen";

export const metadata: Metadata = { title: "Долг" };

export default function DebtPage() {
  return <DebtScreen />;
}
