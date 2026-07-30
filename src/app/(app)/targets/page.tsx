import type { Metadata } from "next";
import { TargetsManager } from "@/components/targets/targets-manager";

export const metadata: Metadata = { title: "Цели" };

export default function TargetsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Цели</h1>
      <TargetsManager />
    </div>
  );
}
