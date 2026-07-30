/**
 * Защита от запуска «облачных» команд по локальной базе.
 *
 * Отдельный .env.production.local сам по себе не спасает: в него легко
 * скопировать локальные значения, и тогда сид/импорт молча отработают не там.
 * Тихий успех не в той базе опаснее явной ошибки — особенно для импорта
 * с --replace, который удаляет данные. Поэтому команды *:prod передают
 * флаг --remote, и скрипт отказывается работать с localhost.
 */

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"];

/**
 * Приводит адрес к базовому виду `https://<ref>.supabase.co`.
 *
 * В панели Supabase рядом с Project URL показаны и REST/GraphQL-адреса —
 * скопировать не тот легко. Клиент дописывает `/auth/v1/...` и `/rest/v1/...`
 * поверх базового адреса, поэтому лишний хвост дает «Invalid path specified
 * in request URL». Чиним молча, но с предупреждением.
 */
export function normalizeSupabaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const cleaned = trimmed.replace(/\/(rest|auth|storage|realtime)\/v\d+$/, "");
  if (cleaned !== trimmed) {
    console.warn(
      `Внимание: из адреса убран лишний хвост — нужен базовый Project URL.\n` +
        `  было:  ${raw}\n  стало: ${cleaned}\n` +
        `Поправьте NEXT_PUBLIC_SUPABASE_URL, чтобы предупреждение не повторялось.\n`,
    );
  }
  return cleaned;
}

export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Прерывает выполнение, если запрошена облачная база, а адрес локальный. */
export function assertRemoteIfRequired(url: string): void {
  if (!process.argv.includes("--remote")) return;
  if (!isLocalUrl(url)) return;

  console.error(
    [
      "",
      "Команда запущена для облачной базы, но адрес указывает на локальную:",
      `  ${url}`,
      "",
      "В .env.production.local должны быть значения ОБЛАЧНОГО проекта Supabase",
      "(Project Settings → API):",
      "  NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co",
      "  NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public>",
      "  SUPABASE_SERVICE_ROLE_KEY=<service_role>",
      "",
      "Если проект еще не создан — см. docs/06-razvertyvanie.md, шаги 1–2.",
      "Для работы с локальной базой используйте команды без :prod.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
