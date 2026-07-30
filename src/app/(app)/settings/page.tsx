import type { Metadata } from "next";

export const metadata: Metadata = { title: "Настройки" };

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>
      <p className="text-sm text-gray-500">
        Здесь появятся настройки аккаунта и отображения.
      </p>
    </div>
  );
}
