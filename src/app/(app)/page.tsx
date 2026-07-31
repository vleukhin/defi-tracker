import type { Metadata } from "next";
import { PortfolioTabs } from "@/components/portfolio/portfolio-tabs";

export const metadata: Metadata = { title: "Портфель" };

export default function DashboardPage() {
  return <PortfolioTabs />;
}
