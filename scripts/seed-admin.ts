/**
 * Сид администратора из переменных окружения (идемпотентно):
 *   npm run seed:admin
 *
 * Требует: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *          ADMIN_EMAIL, ADMIN_PASSWORD.
 * Создает пользователя с подтвержденным email и app_metadata.role = "admin";
 * если пользователь уже существует — обновляет пароль и роль.
 */
import { createClient } from "@supabase/supabase-js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Ошибка: переменная окружения ${name} не задана`);
    process.exit(1);
  }
  return value;
}

const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const email = requiredEnv("ADMIN_EMAIL");
const password = requiredEnv("ADMIN_PASSWORD");

if (password.length < 8) {
  console.error("Ошибка: ADMIN_PASSWORD должен быть не короче 8 символов");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(target: string) {
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const found = data.users.find(
      (u) => u.email?.toLowerCase() === target.toLowerCase(),
    );
    if (found) return found;
    if (data.users.length < perPage) return null;
  }
  return null;
}

async function main() {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "admin" },
  });

  if (!error) {
    console.log(`Администратор создан: ${data.user.email} (${data.user.id})`);
    return;
  }
  if (error.code !== "email_exists") {
    throw new Error(`createUser: ${error.message}`);
  }

  const existing = await findUserByEmail(email);
  if (!existing) {
    throw new Error(
      `Пользователь ${email} существует, но не найден через listUsers`,
    );
  }
  const { error: updateError } = await admin.auth.admin.updateUserById(
    existing.id,
    {
      password,
      email_confirm: true,
      app_metadata: { ...existing.app_metadata, role: "admin" },
    },
  );
  if (updateError) throw new Error(`updateUserById: ${updateError.message}`);
  console.log(
    `Администратор обновлен (пароль и роль): ${email} (${existing.id})`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
