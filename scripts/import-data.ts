/**
 * Восстановление пользовательских данных из резервной копии:
 *   npm run data:import -- --file backup-2026-07-30.json [--email you@example.com]
 *
 * Данные пишутся тому пользователю, чей email указан (по умолчанию —
 * ADMIN_EMAIL). Пользователь должен уже существовать: создайте его через
 * npm run seed:admin.
 *
 * Импорт ИДЕМПОТЕНТЕН по смыслу «не задваивать»: если у пользователя уже
 * есть строки в таблице, она пропускается. Перезаписать существующее можно
 * флагом --replace (данные этой таблицы у пользователя будут удалены).
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertRemoteIfRequired } from "./env-guard.ts";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Ошибка: переменная окружения ${name} не задана`);
    process.exit(1);
  }
  return value;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
assertRemoteIfRequired(url);
const filePath = arg("--file");
const replace = process.argv.includes("--replace");

if (!filePath) {
  console.error("Укажите файл: npm run data:import -- --file backup.json");
  process.exit(1);
}
const email = arg("--email") ?? process.env.ADMIN_EMAIL;
if (!email) {
  console.error("Укажите --email или задайте ADMIN_EMAIL");
  process.exit(1);
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Порядок важен только для читаемости лога: связей между таблицами нет. */
const TABLES = [
  "wallets",
  "manual_positions",
  "portfolio_targets",
  "trades",
] as const;

async function findUserId(target: string): Promise<string> {
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const found = data.users.find(
      (u) => u.email?.toLowerCase() === target.toLowerCase(),
    );
    if (found) return found.id;
    if (data.users.length < perPage) break;
  }
  throw new Error(
    `Пользователь ${target} не найден. Сначала создайте его: npm run seed:admin`,
  );
}

async function main() {
  const backup = JSON.parse(readFileSync(filePath!, "utf8")) as Record<
    string,
    unknown
  >;
  console.log(`Копия от ${backup.exportedAt as string}`);
  console.log(`Источник: ${backup.sourceUrl as string}`);
  console.log(`Цель:     ${url}`);
  console.log(`Владелец: ${email}\n`);

  const userId = await findUserId(email!);

  for (const table of TABLES) {
    const rows = (backup[table] as Record<string, unknown>[] | undefined) ?? [];
    if (rows.length === 0) {
      console.log(`${table.padEnd(20)} — в копии пусто, пропуск`);
      continue;
    }

    const { count, error: countError } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if (countError) throw new Error(`${table} count: ${countError.message}`);

    if ((count ?? 0) > 0) {
      if (!replace) {
        console.log(
          `${table.padEnd(20)} — уже ${count} строк, пропуск (--replace чтобы заменить)`,
        );
        continue;
      }
      const { error: delError } = await admin
        .from(table)
        .delete()
        .eq("user_id", userId);
      if (delError) throw new Error(`${table} delete: ${delError.message}`);
      console.log(`${table.padEnd(20)} — удалено ${count} строк (--replace)`);
    }

    const { error } = await admin
      .from(table)
      .insert(rows.map((r) => ({ ...r, user_id: userId })));
    if (error) throw new Error(`${table} insert: ${error.message}`);
    console.log(`${table.padEnd(20)} + ${rows.length}`);
  }

  console.log(
    "\nГотово. Балансы залога подтянутся при первом «Обновить» на дашборде.",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
