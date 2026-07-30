import type { Metadata } from "next";
import { TargetsManager } from "@/components/portfolio/targets-manager";

export const metadata: Metadata = { title: "Цели и записи" };

export default function TargetsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Цели и записи</h1>
      <TargetsManager />
    </div>
  );
}
