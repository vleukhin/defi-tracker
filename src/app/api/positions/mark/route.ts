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
 * Вложенное задается ДВУМЯ числами — своим и заемным. Одной величиной
 * не обойтись: остаток «стоимость − свое» бывает и заемной частью, и
 * начисленным доходом, и убытком пула, а различить их вычитанием нельзя.
 *
 * null означает «снять разметку», и это НЕ ноль: ноль — утверждение
 * «столько и вложено», null — «еще не сказали».
 */

const ZONES = ["growth", "yield", "stability"] as const;

const bodySchema = z
  .object({
    protocol: z.enum(POSITION_SOURCES),
    chain: z.enum(CHAIN_IDS),
    externalId: z.string().min(1).max(200),
    zone: z.enum(ZONES).nullish(),
    ownPrincipalUsd: z.number().min(0).nullish(),
    borrowedPrincipalUsd: z.number().min(0).nullish(),
    withdrawnUsd: z.number().min(0).nullish(),
    // Точка отсчёта падения (docs/07 §5). Строго больше нуля, в отличие
    // от сумм: от нулевой цены падение не считается, это не «ноль долларов»
    entryPriceUsd: z
      .number()
      .positive("Цена входа должна быть больше нуля")
      .nullish(),
  })
  // Пустая правка бессмысленна: хотя бы одно поле должно быть задано
  .refine(
    (v) =>
      v.zone !== undefined ||
      v.ownPrincipalUsd !== undefined ||
      v.borrowedPrincipalUsd !== undefined ||
      v.withdrawnUsd !== undefined ||
      v.entryPriceUsd !== undefined,
    { message: "Нужно задать зону, вложенные суммы или цену входа" },
  );

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
  const {
    protocol,
    chain,
    externalId,
    zone,
    ownPrincipalUsd,
    borrowedPrincipalUsd,
    withdrawnUsd,
    entryPriceUsd,
  } = parsed.data;

  // Точка отсчёта GM — не самостоятельное поле разметки, а быстрая копия
  // последней записи gm_reference_points. Старое поле оставлено в форме для
  // исправления цены без открытия нового цикла (docs/09 S8.4), но писать его
  // напрямую после Фазы 8 значило бы разрешить копии разойтись с журналом.
  if (entryPriceUsd !== undefined && protocol !== "gmx_v2") {
    return apiError(400, "Точка отсчёта бывает только у GM-пула");
  }

  // Пустое поле у остальных величин значит «снять разметку», но точку
  // отсчёта так снять нельзя: за ней стоит запись журнала, на которую
  // ссылаются отметки уровней. Удаление живёт отдельным действием со
  // своими запретами (последняя точка, без ссылающихся операций), и
  // тихо обойти их через форму разметки — значит потерять цикл.
  if (entryPriceUsd === null) {
    return apiError(
      400,
      "Цену входа нельзя стереть: точка отсчёта снимается кнопкой «отменить точку» в журнале уровней",
    );
  }

  // Читаем текущую строку: PUT правит только переданные поля и не затирает
  // соседнее — зону и долю пользователь задает по отдельности
  const { data: existing, error: readError } = await supabase
    .from("position_marks")
    .select(
      "zone, own_principal_usd, borrowed_principal_usd, withdrawn_usd, entry_price_usd",
    )
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
      own_principal_usd:
        ownPrincipalUsd === undefined
          ? ((existing?.own_principal_usd as number | null) ?? null)
          : ownPrincipalUsd,
      borrowed_principal_usd:
        borrowedPrincipalUsd === undefined
          ? ((existing?.borrowed_principal_usd as number | null) ?? null)
          : borrowedPrincipalUsd,
      withdrawn_usd:
        withdrawnUsd === undefined
          ? ((existing?.withdrawn_usd as number | null) ?? null)
          : withdrawnUsd,
      // При правке цены ниже копию обновит триггер gm_reference_points.
      // До него сохраняем прежнее значение, чтобы один и тот же факт не жил
      // в двух независимых пишущих путях.
      entry_price_usd: (existing?.entry_price_usd as number | null) ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,protocol,chain,external_id" },
  );
  if (error) return apiError(500, error.message);

  if (entryPriceUsd !== undefined) {
    const { data: current, error: currentError } = await supabase
      .from("gm_reference_points")
      .select("id")
      .eq("protocol", protocol)
      .eq("chain", chain)
      .eq("external_id", externalId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (currentError) {
      return apiError(500, "Не удалось прочитать точку отсчёта");
    }

    const pointWrite = current
      ? supabase.from("gm_reference_points").update({ price_usd: entryPriceUsd }).eq("id", current.id)
      : supabase.from("gm_reference_points").insert({
          user_id: user.id,
          protocol,
          chain,
          external_id: externalId,
          price_usd: entryPriceUsd,
          // Старую цену могли вводить задним числом — не объявляем её
          // сегодняшней только потому, что журнал появился позже.
          set_at: null,
          source: "manual",
          note: null,
        });
    // Текст ошибки БД наружу не отдаём: проверки здесь называются
    // по-английски именами констрейнтов, и в тост ушло бы
    // «violates check constraint gm_reference_points_price_usd_check»
    const { error: pointError } = await pointWrite;
    if (pointError) return apiError(500, "Не удалось сохранить точку отсчёта");
  }

  return NextResponse.json({ ok: true });
}
