import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import { POSITION_SOURCES } from "@/lib/positions/sources";
import { CHAIN_IDS } from "@/lib/chains/config";

/**
 * PUT /api/positions/mark — разметка позиции (Фаза 6): зона стратегии и
 * доля собственных средств.
 *
 * Адресуется натуральным ключом (протокол, сеть, external_id), а не id строки
 * protocol_positions: читатели цепочек пересоздают эти строки, а CLMM при
 * перезаливке диапазона выдает новый tokenId. По id разметка терялась бы
 * при каждом обновлении.
 *
 * ownUsd = null означает «снять разметку» и вернуться к состоянию
 * «не размечено», которое НЕ равно нулю: ноль — это утверждение «позиция
 * целиком на заемные», а null — «еще не сказали».
 */

const ZONES = ["growth", "yield", "stability"] as const;

const bodySchema = z
  .object({
    protocol: z.enum(POSITION_SOURCES),
    chain: z.enum(CHAIN_IDS),
    externalId: z.string().min(1).max(200),
    zone: z.enum(ZONES).nullish(),
    ownUsd: z.number().min(0).nullish(),
  })
  // Пустая правка бессмысленна: хотя бы одно поле должно быть задано
  .refine((v) => v.zone !== undefined || v.ownUsd !== undefined, {
    message: "Нужно задать зону или долю собственных средств",
  });

export async function PUT(request: NextRequest) {
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
    return apiError(
      400,
      parsed.error.issues[0]?.message ?? "Неверные данные разметки",
    );
  }
  const { protocol, chain, externalId, zone, ownUsd } = parsed.data;

  // Читаем текущую строку: PUT правит только переданные поля и не затирает
  // соседнее — зону и долю пользователь задает по отдельности
  const { data: existing, error: readError } = await supabase
    .from("position_marks")
    .select("zone, own_usd")
    .eq("protocol", protocol)
    .eq("chain", chain)
    .eq("external_id", externalId)
    .maybeSingle();
  if (readError) return apiError(500, readError.message);

  const { error } = await supabase.from("position_marks").upsert(
    {
      user_id: user.id,
      protocol,
      chain,
      external_id: externalId,
      zone: zone === undefined ? ((existing?.zone as string | null) ?? null) : zone,
      own_usd:
        ownUsd === undefined
          ? ((existing?.own_usd as number | null) ?? null)
          : ownUsd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,protocol,chain,external_id" },
  );
  if (error) return apiError(500, error.message);

  return NextResponse.json({ ok: true });
}
