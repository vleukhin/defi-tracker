import type { Metadata } from "next";
import { ReadOnlyNotice } from "@/components/read-only-notice";

export const metadata: Metadata = { title: "Кошельки" };

export default function WalletsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Кошельки</h1>
      <ReadOnlyNotice />
      <p className="text-sm text-gray-500">
        Здесь появится управление read-only EVM-адресами (Ethereum, Arbitrum,
        Base, Optimism).
      </p>
    </div>
  );
}
