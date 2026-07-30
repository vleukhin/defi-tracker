import type { Metadata } from "next";

export const metadata: Metadata = { title: "Дашборд" };

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Дашборд</h1>
      <p className="text-sm text-gray-500">
        Здесь появится аллокация портфеля: стоимость, текущие и целевые
        проценты, отклонения.
      </p>
    </div>
  );
}
