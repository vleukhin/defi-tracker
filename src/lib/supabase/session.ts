import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Проверка сессии по подписи JWT, а не запросом к серверу Auth.
 *
 * `getUser()` — это HTTP-запрос к `/auth/v1/user` на КАЖДЫЙ вызов. Проверка
 * сессии делается дважды за запрос (прокси + сам роут), а экран «Портфель»
 * шлёт пять запросов сразу — то есть больше десятка обращений к Auth ещё
 * до первого запроса данных. При базе в eu-west-1 это единицы секунд
 * чистого ожидания сети.
 *
 * `getClaims()` вместо этого проверяет подпись токена локально через
 * WebCrypto, а публичные ключи (JWKS) кэширует в памяти процесса на 10 минут
 * — общим кэшем на все экземпляры клиента, так что тёплая функция Vercel
 * ходит за ключами раз в 10 минут, а не раз в запрос.
 *
 * Гарантии по сравнению с getUser():
 *  * подлинность токена — та же (подпись проверена, подделать нельзя);
 *  * отзыв сессии виден не мгновенно, а к истечению access-токена (по
 *    умолчанию час): выход на другом устройстве не обрывает текущую сессию
 *    немедленно. Для трекера собственного портфеля это приемлемо; RLS всё
 *    так же режет данные по user_id.
 *
 * ВАЖНО: локальной проверка становится, только когда проект Supabase
 * подписывает JWT асимметричным ключом (Dashboard → Settings → JWT Keys).
 * На симметричном секрете (HS256) getClaims сам падает обратно в сетевой
 * getUser() — работать будет, но выигрыша не даст.
 */

export interface SessionUser {
  id: string;
  email: string | null;
  /** Роль лежит в app_metadata.role и приходит внутри подписанного JWT. */
  app_metadata: { role?: string } & Record<string, unknown>;
}

export async function verifiedUser(
  supabase: SupabaseClient,
): Promise<SessionUser | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;

  const { claims } = data;
  // sub — идентификатор пользователя; без него токен бесполезен
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return null;

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    app_metadata: (claims.app_metadata ?? {}) as SessionUser["app_metadata"],
  };
}
