import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import { AAVE_PROTOCOL } from "@/lib/chains/aave";
import { POSITION_SOURCES } from "@/lib/positions/sources";
import type { BorrowLinkDto } from "@/lib/api/types";

/**
 * POST /api/borrow-links — привязка «этот займ профинансировал эту позицию»
 * (S5.3). Связь многие-ко-многим: один займ может кормить несколько позиций
 * и наоборот.
 *
 * Метка чисто бухгалтерская: на портфель и на пять чисел не влияет, влияет
 * только на экран «Левередж».
 *
 * z.guid(), а не z.uuid(): последний требует корректную версию UUID и
 * отвергает засеянные идентификаторы вида ...0001.
 */

const bodySchema = z.object({
  borrowId: z.guid(),
  positionId: z.guid(),
});

export async function POST(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Тело запроса не является JSON");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Нужны borrowId и positionId (UUID)");
  }
  const { borrowId, positionId } = parsed.data;

  if (borrowId === positionId) {
    return apiError(400, "Займ нельзя привязать к самому себе");
  }

  // Обе стороны обязаны быть видимы пользователю. RLS сама по себе проверяет
  // только user_id самой связки, поэтому принадлежность позиций (они
  // wallet-scoped) проверяется здесь явно.
  const { data: refs, error: refsError } = await supabase
    .from("protocol_positions")
    .select("id, protocol, payload")
    .in("id", [borrowId, positionId]);
  if (refsError) return apiError(500, refsError.message);

  const borrow = (refs ?? []).find((r) => r.id === borrowId);
  const position = (refs ?? []).find((r) => r.id === positionId);
  if (!borrow || !position) {
    return apiError(404, "Займ или позиция не найдены");
  }

  const borrowPayload = borrow.payload as { kind?: string } | null;
  if (borrow.protocol !== AAVE_PROTOCOL || borrowPayload?.kind !== "debt") {
    return apiError(400, "Первая сторона связки должна быть займом");
  }
  if (!POSITION_SOURCES.includes(position.protocol as never)) {
    return apiError(400, "Вторая сторона связки должна быть размещением");
  }

  const { data, error } = await supabase
    .from("borrow_links")
    .upsert(
      { user_id: user.id, borrow_ref: borrowId, position_ref: positionId },
      { onConflict: "user_id,borrow_ref,position_ref" },
    )
    .select("id, borrow_ref, position_ref, created_at")
    .single();
  if (error) return apiError(500, error.message);

  const link: BorrowLinkDto = {
    id: data.id as string,
    borrowId: data.borrow_ref as string,
    positionId: data.position_ref as string,
    createdAt: data.created_at as string,
  };
  return NextResponse.json({ link }, { status: 201 });
}

/**
 * DELETE /api/borrow-links?borrowId=&positionId= — снять привязку.
 *
 * Адресуется парой, а не id связки: пара и есть уникальный ключ
 * (UNIQUE user_id, borrow_ref, position_ref), и клиенту не приходится
 * держать у себя третий идентификатор.
 *
 * Удаляется только метка: ни позиция, ни долг никуда не деваются, и ни одно
 * число портфеля не меняется.
 */
export async function DELETE(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const borrowId = request.nextUrl.searchParams.get("borrowId") ?? "";
  const positionId = request.nextUrl.searchParams.get("positionId") ?? "";
  if (!bodySchema.safeParse({ borrowId, positionId }).success) {
    return apiError(400, "Нужны borrowId и positionId (UUID)");
  }

  // Выборкой правит RLS: чужую связку этот запрос просто не увидит
  const { data, error } = await supabase
    .from("borrow_links")
    .delete()
    .eq("borrow_ref", borrowId)
    .eq("position_ref", positionId)
    .select("id");
  if (error) return apiError(500, error.message);
  if (!data || data.length === 0) return apiError(404, "Связка не найдена");

  return NextResponse.json({ ok: true });
}
