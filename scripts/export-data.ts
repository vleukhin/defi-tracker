/**
 * Резервная копия пользовательских данных:
 *   npm run data:export [-- --out backup.json]
 *
 * Выгружает только то, что введено руками и невосстановимо: кошельки,
 * ручные записи, цели и сделки. Кэши (залог Aave, цены, статусы сетей)
 * не выгружаются — они пересобираются кнопкой «Обновить».
 *
 * user_id намеренно НЕ сохраняется: в другой базе у пользователя будет
 * другой идентификатор, и импорт подставит актуальный.
 *
 * Требует NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assertRemoteIfRequired, normalizeSupabaseUrl } from "./env-guard.ts";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Ошибка: переменная окружения ${name} не задана`);
    process.exit(1);
  }
  return value;
}

const url = normalizeSupabaseUrl(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"));
const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

assertRemoteIfRequired(url);
console.log(`База: ${url}\n`);

const outArgIndex = process.argv.indexOf("--out");
const outPath =
  outArgIndex !== -1 && process.argv[outArgIndex + 1]
    ? process.argv[outArgIndex + 1]
    : `backup-${new Date().toISOString().slice(0, 10)}.json`;

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Таблицы с ручными данными: колонки без id и user_id — они назначаются при импорте. */
const TABLES = {
  wallets: "address, label, created_at",
  manual_positions: "category, label, amount, created_at",
  portfolio_targets: "category, target_pct, created_at, updated_at",
  trades: "category, side, quantity, price_usd, traded_at, note, created_at",
} as const;

async function main() {
  const { data: users, error: usersError } =
    await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (usersError) throw new Error(`listUsers: ${usersError.message}`);

  const payload: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    sourceUrl: url,
    // Email нужен, чтобы при импорте понять, чьи это данные
    users: users.users.map((u) => ({
      email: u.email,
      role: u.app_metadata?.role ?? "user",
    })),
  };

  for (const [table, columns] of Object.entries(TABLES)) {
    const { data, error } = await admin.from(table).select(columns);
    if (error) throw new Error(`${table}: ${error.message}`);
    payload[table] = data ?? [];
    console.log(`${table.padEnd(20)} ${(data ?? []).length}`);
  }

  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\nРезервная копия сохранена: ${outPath}`);
  console.log("Восстановление: npm run data:import -- --file " + outPath);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
