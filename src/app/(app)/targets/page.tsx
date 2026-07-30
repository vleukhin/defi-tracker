import type { Metadata } from "next";

export const metadata: Metadata = { title: "Цели" };

export default function TargetsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Цели</h1>
      <p className="text-sm text-gray-500">
        Здесь появится редактор корзин и целевых пропорций аллокации.
      </p>
    </div>
  );
}
