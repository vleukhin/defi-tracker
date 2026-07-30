import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";

/**
 * GET  /api/buckets — встроенные + свои корзины.
 * POST /api/buckets — создать пользовательскую корзину (S1.6),
 *   например «L2-альты».
 */

const createSchema = z.object({
  name: z.string().trim().min(1).max(64),
});

export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { data, error } = await supabase
    .from("buckets")
    .select("id, user_id, name")
    .order("created_at", { ascending: true });
  if (error) return apiError(500, error.message);

  return NextResponse.json({
    buckets: (data ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      builtin: b.user_id === null,
    })),
  });
}

export async function POST(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Невалидный JSON");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Невалидное имя корзины");
  }

  const { data, error } = await supabase
    .from("buckets")
    .insert({ user_id: user.id, name: parsed.data.name })
    .select("id, name")
    .single();
  if (error) {
    if (error.code === "23505") {
      return apiError(409, "Корзина с таким именем уже существует");
    }
    return apiError(500, error.message);
  }

  return NextResponse.json(
    { bucket: { id: data.id, name: data.name, builtin: false } },
    { status: 201 },
  );
}
