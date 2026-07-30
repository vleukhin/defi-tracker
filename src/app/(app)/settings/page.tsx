import type { Metadata } from "next";
import { NBSP } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { UsersManager } from "@/components/settings/users-manager";

export const metadata: Metadata = { title: "Настройки" };

/**
 * Настройки — честный минимум Фазы 1: email аккаунта и порог отклонения
 * (фиксированный). Выход — кнопка «Выйти» в навигации.
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAdmin = user?.app_metadata?.role === "admin";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>

      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        <div className="px-4 py-3">
          <p className="text-xs text-gray-500">Email</p>
          <p className="text-sm text-gray-900">{user?.email ?? "—"}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-gray-500">Порог выделения отклонения</p>
          <p className="text-sm text-gray-900">5{NBSP}п.п.</p>
          <p className="mt-0.5 text-xs text-gray-400">
            Настраивается в будущих версиях.
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-gray-500">Выход из аккаунта</p>
          <p className="text-sm text-gray-900">
            Кнопка «Выйти» — в навигации сверху.
          </p>
        </div>
      </div>

      {isAdmin && user && <UsersManager selfId={user.id} />}

      <p className="text-xs text-gray-400">
        Суммы ребалансировки на дашборде — расчеты, а не финансовые советы.
      </p>
    </div>
  );
}
