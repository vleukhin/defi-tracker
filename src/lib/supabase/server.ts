import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase-клиент для серверных компонентов, route handlers и server actions.
 * Создавать новый клиент на каждый запрос (не кэшировать в модуле).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Вызов из server component: куки может выставить только proxy,
            // обновляющий сессию. Игнорируем.
          }
        },
      },
    },
  );
}
