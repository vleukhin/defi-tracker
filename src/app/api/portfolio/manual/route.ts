import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import {
  PORTFOLIO_CATEGORIES,
  type PortfolioCategory,
} from "@/lib/portfolio/portfolio";

/**
 * Ручные записи (S1.4): подписанные суммы стейблов в USD и корректировки
 * BTC/ETH в монетах — для средств вне лендинга (биржа, холодный кошелек).
 */

const createSchema = z.object({
  category: z.enum(PORTFOLIO_CATEGORIES),
  label: z.string().trim().min(1, "Подпись обязательна").max(60),
  // Строкой, чтобы не терять точность на длинных дробях; проверяем формат
  amount: z
    .union([z.number(), z.string()])
    .transform((v) => String(v).trim().replace(",", "."))
    .refine((v) => /^\d+(\.\d+)?$/.test(v), "Количество должно быть числом")
    .refine((v) => Number.parseFloat(v) > 0, "Количество должно быть больше нуля"),
});

export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { data, error } = await supabase
    .from("manual_positions")
    .select("id, category, label, amount, created_at")
    .order("created_at", { ascending: true });
  if (error) return apiError(500, error.message);

  return NextResponse.json({
    entries: (data ?? []).map((r) => ({
      id: r.id as string,
      category: r.category as PortfolioCategory,
      label: r.label as string,
      amount: String(r.amount),
      createdAt: r.created_at as string,
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
    return apiError(400, "Невалидные данные", {
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  const { category, label, amount } = parsed.data;
  const { data, error } = await supabase
    .from("manual_positions")
    .insert({ user_id: user.id, category, label, amount })
    .select("id, category, label, amount, created_at")
    .single();
  if (error) return apiError(500, error.message);

  return NextResponse.json(
    {
      entry: {
        id: data.id as string,
        category: data.category as PortfolioCategory,
        label: data.label as string,
        amount: String(data.amount),
        createdAt: data.created_at as string,
      },
    },
    { status: 201 },
  );
}
