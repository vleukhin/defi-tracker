import type { Metadata } from "next";
import { DebtTabs } from "@/components/debt/debt-tabs";

export const metadata: Metadata = { title: "Долг" };

export default function DebtPage() {
  return <DebtTabs />;
}
