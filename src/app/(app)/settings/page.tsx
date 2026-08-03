import type { Metadata } from "next";
import { Disclaimer } from "@/components/dc/card";
import { PageHeader } from "@/components/dc/page-header";
import { AccountCard } from "@/components/settings/account-card";
import { UsersManager } from "@/components/settings/users-manager";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Настройки" };

/**
 * «Настройки» (README §9): аккаунт и вид, пороги предупреждений,
 * пользователи (только администратору). Выход — кнопка «Выйти» в навигации.
 *
 * Контент сужается до 840px: строки label/control длиной в 1120px читались
 * бы как таблица, а это форма. Общий .page-shell из layout не трогаем —
 * ограничение ставится здесь, поверх него.
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAdmin = user?.app_metadata?.role === "admin";

  return (
    <TooltipProvider>
      <div className="mx-auto flex w-full max-w-[840px] flex-col gap-4">
        <PageHeader
          title="Настройки"
          meta={<span>аккаунт, вид и пороги предупреждений</span>}
        />

        <AccountCard email={user?.email ?? null} />

        {isAdmin && user && <UsersManager selfId={user.id} />}

        <Disclaimer>
          Суммы к ребалансировке и оценки риска — расчёт, а не финансовый совет.
        </Disclaimer>
      </div>
    </TooltipProvider>
  );
}
