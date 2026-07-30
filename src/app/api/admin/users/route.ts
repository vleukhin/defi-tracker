import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, apiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Управление пользователями. Публичной регистрации нет (enable_signup=false):
 * аккаунты создает администратор; email сразу помечается подтвержденным.
 */

const createSchema = z.object({
  email: z.email("Некорректный email"),
  password: z.string().min(8, "Пароль минимум 8 символов"),
});

export async function GET() {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) return unauthorized;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) return apiError(502, `Не удалось получить пользователей: ${error.message}`);

  return NextResponse.json({
    users: data.users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.app_metadata?.role === "admin" ? "admin" : "user",
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
    })),
  });
}

export async function POST(request: NextRequest) {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Невалидный JSON");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Невалидные данные", {
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (error) {
    if (error.code === "email_exists") {
      return apiError(409, "Пользователь с таким email уже существует");
    }
    return apiError(502, `Не удалось создать пользователя: ${error.message}`);
  }

  return NextResponse.json(
    { user: { id: data.user.id, email: data.user.email, role: "user" } },
    { status: 201 },
  );
}
