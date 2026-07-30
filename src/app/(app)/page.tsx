import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard/dashboard";

export const metadata: Metadata = { title: "Дашборд" };

export default function DashboardPage() {
  return <Dashboard />;
}
