import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { NBSP } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { HfThresholdRow } from "@/components/settings/hf-threshold-row";
import { ThemeRow } from "@/components/settings/theme-row";
import { UsersManager } from "@/components/settings/users-manager";

export const metadata: Metadata = { title: "Настройки" };

/**
 * Настройки — честный минимум Фазы 1: email аккаунта, тема и порог
 * отклонения (фиксированный). Выход — кнопка «Выйти» в навигации.
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

      <Card className="divide-y divide-border p-0">
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Email</p>
          <p className="mt-0.5 font-mono text-sm">{user?.email ?? "—"}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Тема</p>
          <div className="mt-1.5">
            <ThemeRow />
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Порог выделения отклонения
          </p>
          <p className="mt-0.5 font-mono text-sm">5{NBSP}п.п.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Настраивается в будущих версиях.
          </p>
        </div>
        {/* Фаза 4 (S4.3): настраиваемый порог предупреждения по HF */}
        <HfThresholdRow />
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Выход из аккаунта</p>
          <p className="mt-0.5 text-sm">Кнопка «Выйти» — в навигации сверху.</p>
        </div>
      </Card>

      {isAdmin && user && <UsersManager selfId={user.id} />}

      <p className="text-xs text-muted-foreground">
        Суммы ребалансировки на дашборде — расчеты, а не финансовые советы.
      </p>
    </div>
  );
}
