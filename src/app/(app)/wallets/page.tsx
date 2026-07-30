import type { Metadata } from "next";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { WalletsManager } from "@/components/wallets/wallets-manager";

export const metadata: Metadata = { title: "Кошельки" };

export default function WalletsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Кошельки</h1>
      <ReadOnlyNotice />
      <WalletsManager />
    </div>
  );
}
