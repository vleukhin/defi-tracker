/**
 * Базовый адрес проекта Supabase из переменной окружения.
 *
 * В панели Supabase рядом с Project URL показаны REST- и GraphQL-адреса
 * (`…/rest/v1/`, `…/graphql/v1`), скопировать не тот легко. Клиент дописывает
 * `/auth/v1/...` и `/rest/v1/...` сам, поэтому лишний хвост дает запросы
 * вида `/rest/v1/auth/v1/token` и молчаливую невозможность войти.
 *
 * Нормализация здесь, а не только в скриптах: переменную задают руками
 * в панели Vercel, а NEXT_PUBLIC_* вшивается в клиентский бандл на сборке —
 * цена опечатки слишком высока, чтобы полагаться на внимательность.
 */
export function supabaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) throw new Error("NEXT_PUBLIC_SUPABASE_URL не задан");
  return normalizeSupabaseUrl(raw);
}

export function normalizeSupabaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(rest|auth|storage|realtime|graphql)\/v\d+$/, "");
}
