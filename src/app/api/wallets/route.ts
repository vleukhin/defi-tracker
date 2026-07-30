import { NextResponse, type NextRequest } from "next/server";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";

/**
 * GET  /api/wallets — список кошельков пользователя.
 * POST /api/wallets — добавить read-only адрес (S1.2):
 *   валидация формата и EIP-55 checksum (lowercase принимается,
 *   хранится checksummed), опциональная метка, дубликаты отклоняются.
 */

const createWalletSchema = z.object({
  address: z.string().trim(),
  label: z.string().trim().min(1).max(64).optional(),
});

export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { data, error } = await supabase
    .from("wallets")
    .select("id, address, label, last_refreshed_at, created_at")
    .order("created_at", { ascending: true });
  if (error) return apiError(500, error.message);

  return NextResponse.json({
    wallets: (data ?? []).map((w) => ({
      id: w.id,
      address: w.address,
      label: w.label,
      lastRefreshedAt: w.last_refreshed_at,
      createdAt: w.created_at,
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

  const parsed = createWalletSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Невалидные данные", {
      issues: parsed.error.issues.map((i) => i.message),
    });
  }

  // EIP-55: lowercase принимается, mixed-case c неверным checksum — нет
  const rawAddress = parsed.data.address;
  if (!isAddress(rawAddress)) {
    return apiError(400, "Невалидный EVM-адрес (формат или EIP-55 checksum)");
  }
  const address = getAddress(rawAddress); // хранить checksummed

  const { data, error } = await supabase
    .from("wallets")
    .insert({
      user_id: user.id,
      address,
      label: parsed.data.label ?? null,
    })
    .select("id, address, label, last_refreshed_at, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiError(409, "Этот адрес уже добавлен");
    }
    return apiError(500, error.message);
  }

  return NextResponse.json(
    {
      wallet: {
        id: data.id,
        address: data.address,
        label: data.label,
        lastRefreshedAt: data.last_refreshed_at,
        createdAt: data.created_at,
      },
    },
    { status: 201 },
  );
}
