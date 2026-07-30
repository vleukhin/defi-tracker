import type { Metadata } from "next";
import { PortfolioDashboard } from "@/components/portfolio/portfolio-dashboard";

export const metadata: Metadata = { title: "Портфель" };

export default function DashboardPage() {
  return <PortfolioDashboard />;
}
