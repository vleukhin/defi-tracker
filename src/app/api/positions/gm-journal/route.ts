import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import { CHAIN_IDS } from "@/lib/chains/config";
import type {
  GmJournalDto,
  GmJournalsResponseDto,
  GmLevelActionDto,
  GmReferencePointDto,
} from "@/lib/api/types";

/**
 * Журнал действий GM и границ циклов (Фаза 8).
 *
 * Точки и действия — пользовательские записи, в отличие от строк читателя
 * цепочки, поэтому их идентификаторы устойчивы. Позиция на входе всё равно
 * адресуется натуральным ключом: это тот же ключ, которым живёт mark.
 */

/**
 * Код ошибки PostgreSQL в человеческую фразу. Текст самой БД наружу не
 * отдаётся: проверки этой фазы называются по-английски именами констрейнтов
 * («violates check constraint gm_level_actions_funds_source_matches_kind»),
 * и в тосте владельца такая строка не сообщает ничего.
 */
function journalDbMessage(code: string | undefined): string {
  if (code === "23503") return "Сначала удалите операции этой точки";
  if (code === "23514") {
    return "Запись не проходит проверку: количество GM должно быть больше нуля, у покупки нужен источник денег";
  }
  if (code === "23502") return "Не заполнено обязательное поле записи";
  return "Не удалось сохранить запись журнала";
}

const positionSchema = z.object({
  protocol: z.literal("gmx_v2"),
  chain: z.enum(CHAIN_IDS),
  externalId: z.string().min(1).max(200),
});

const decimal = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/, "Нужно положительное десятичное число")
  .refine((v) => Number(v) > 0, "Число должно быть больше нуля");

const optionalAmount = z.number().finite().min(0).nullable().optional();
const optionalNote = z.string().trim().min(1).max(200).nullable().optional();
const isoTime = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Date.parse(v) <= Date.now() + 5 * 60_000, "Дата не может быть в будущем");

const actionBody = z.object({
  operation: z.literal("action"),
  referencePointId: z.string().uuid(),
  dropPercent: z.union([
    z.literal(7),
    z.literal(15),
    z.literal(30),
    z.literal(50),
    z.literal(70),
    z.literal(-50),
  ]),
  kind: z.enum(["sell", "buy"]),
  gmAmount: decimal,
  fundsSource: z.enum(["proceeds", "stability", "yield_reserve"]).nullable(),
  assetAmount: optionalAmount,
  usdAmount: optionalAmount,
  assetPriceUsd: z.number().finite().positive().nullable().optional(),
  happenedAt: isoTime,
  note: optionalNote,
}).superRefine((v, ctx) => {
  if (v.kind === "sell" && v.fundsSource !== null) {
    ctx.addIssue({ code: "custom", path: ["fundsSource"], message: "У продажи нет источника денег" });
  }
  if (v.kind === "buy" && v.fundsSource === null) {
    ctx.addIssue({ code: "custom", path: ["fundsSource"], message: "Укажите источник денег для покупки" });
  }
});

const referenceBody = positionSchema.extend({
  operation: z.literal("reference"),
  priceUsd: z.number().finite().positive(),
  /** null — время старой точки неизвестно; отсутствие подставляет now(). */
  setAt: z.string().datetime({ offset: true }).nullable().optional(),
  source: z.enum(["manual", "chain", "current_price"]),
  note: optionalNote,
});

const updateBody = z.union([
  z.object({
    operation: z.literal("update-action"), id: z.string().uuid(),
    referencePointId: z.string().uuid(),
    dropPercent: z.union([z.literal(7), z.literal(15), z.literal(30), z.literal(50), z.literal(70), z.literal(-50)]),
    kind: z.enum(["sell", "buy"]), gmAmount: decimal,
    fundsSource: z.enum(["proceeds", "stability", "yield_reserve"]).nullable(),
    assetAmount: optionalAmount, usdAmount: optionalAmount,
    assetPriceUsd: z.number().finite().positive().nullable().optional(),
    happenedAt: isoTime, note: optionalNote,
  }).superRefine((v, ctx) => {
    if (v.kind === "sell" && v.fundsSource !== null) ctx.addIssue({ code: "custom", path: ["fundsSource"], message: "У продажи нет источника денег" });
    if (v.kind === "buy" && v.fundsSource === null) ctx.addIssue({ code: "custom", path: ["fundsSource"], message: "Укажите источник денег для покупки" });
  }),
  z.object({
    operation: z.literal("update-reference"),
    id: z.string().uuid(),
    priceUsd: z.number().finite().positive(),
    note: optionalNote,
  }),
]);

function zoneKey(row: { protocol: string; chain: string; external_id: string }): string {
  return `${row.protocol}:${row.chain}:${row.external_id}`;
}

function actionDto(row: Record<string, unknown>): GmLevelActionDto {
  return {
    id: String(row.id),
    referencePointId: String(row.reference_point_id),
    dropPercent: Number(row.drop_percent),
    kind: row.kind as GmLevelActionDto["kind"],
    gmAmount: String(row.gm_amount),
    fundsSource: row.funds_source as GmLevelActionDto["fundsSource"],
    assetAmount: row.asset_amount === null ? null : String(row.asset_amount),
    usdAmount: row.usd_amount === null ? null : String(row.usd_amount),
    assetPriceUsd: row.asset_price_usd === null ? null : Number(row.asset_price_usd),
    happenedAt: String(row.happened_at),
    note: row.note as string | null,
    createdAt: String(row.created_at),
  };
}

function pointDto(
  row: Record<string, unknown>,
  actions: GmLevelActionDto[],
): GmReferencePointDto {
  return {
    id: String(row.id),
    priceUsd: Number(row.price_usd),
    setAt: row.set_at as string | null,
    source: row.source as GmReferencePointDto["source"],
    note: row.note as string | null,
    createdAt: String(row.created_at),
    actions,
  };
}

/** Все журналы пользователя: экран получает их одним запросом, не по пулу. */
export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { data: points, error: pointsError } = await supabase
    .from("gm_reference_points")
    .select("id, protocol, chain, external_id, price_usd, set_at, source, note, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (pointsError) return apiError(500, "Не удалось прочитать точки отсчёта");

  const ids = (points ?? []).map((p) => String(p.id));
  const { data: actions, error: actionsError } = ids.length === 0
    ? { data: [], error: null }
    : await supabase
      .from("gm_level_actions")
      .select("id, reference_point_id, drop_percent, kind, gm_amount, funds_source, asset_amount, usd_amount, asset_price_usd, happened_at, note, created_at")
      .in("reference_point_id", ids)
      .order("happened_at", { ascending: false })
      .order("created_at", { ascending: false });
  if (actionsError) return apiError(500, "Не удалось прочитать журнал операций");

  const actionsByPoint = new Map<string, GmLevelActionDto[]>();
  for (const row of actions ?? []) {
    const action = actionDto(row as Record<string, unknown>);
    const items = actionsByPoint.get(action.referencePointId) ?? [];
    items.push(action);
    actionsByPoint.set(action.referencePointId, items);
  }

  const byPosition = new Map<string, GmJournalDto>();
  for (const row of points ?? []) {
    const key = zoneKey(row as { protocol: string; chain: string; external_id: string });
    const journal = byPosition.get(key) ?? { zoneKey: key, points: [] };
    journal.points.push(pointDto(row as Record<string, unknown>, actionsByPoint.get(String(row.id)) ?? []));
    byPosition.set(key, journal);
  }

  const response: GmJournalsResponseDto = { journals: [...byPosition.values()] };
  return NextResponse.json(response);
}

export async function POST(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;
  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "Тело запроса не является JSON"); }

  const operation = (body as { operation?: unknown } | null)?.operation;
  const parsed = operation === "action" ? actionBody.safeParse(body) : referenceBody.safeParse(body);
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "Неверные данные журнала");

  if (parsed.data.operation === "action") {
    const v = parsed.data;
    // Операции прошлого цикла остаются читаемыми и редактируемыми, но новую
    // запись в закрытый цикл добавить нельзя: иначе она внезапно вернула бы
    // отметку на шкалу после отмены/переноса точки.
    const { data: point, error: pointError } = await supabase
      .from("gm_reference_points")
      .select("id, protocol, chain, external_id")
      .eq("id", v.referencePointId).maybeSingle();
    if (pointError) return apiError(500, "Не удалось прочитать точку отсчёта");
    if (!point) return apiError(404, "Точка отсчёта не найдена");
    const { data: current, error: currentError } = await supabase
      .from("gm_reference_points").select("id")
      .eq("protocol", point.protocol).eq("chain", point.chain).eq("external_id", point.external_id)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(1).maybeSingle();
    if (currentError) return apiError(500, "Не удалось прочитать текущую точку отсчёта");
    if (current?.id !== v.referencePointId) return apiError(409, "Операцию можно добавить только в текущий цикл");
    const { error } = await supabase.from("gm_level_actions").insert({
      user_id: user.id, reference_point_id: v.referencePointId, drop_percent: v.dropPercent,
      kind: v.kind, gm_amount: v.gmAmount, funds_source: v.fundsSource,
      asset_amount: v.assetAmount ?? null, usd_amount: v.usdAmount ?? null,
      asset_price_usd: v.assetPriceUsd ?? null, happened_at: v.happenedAt, note: v.note ?? null,
    });
    if (error) return apiError(error.code === "23503" ? 404 : 500, error.code === "23503" ? "Точка отсчёта не найдена" : journalDbMessage(error.code));
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  const v = parsed.data;
  const { error } = await supabase.from("gm_reference_points").insert({
    user_id: user.id, protocol: v.protocol, chain: v.chain, external_id: v.externalId,
    price_usd: v.priceUsd, set_at: v.setAt === undefined ? new Date().toISOString() : v.setAt,
    source: v.source, note: v.note ?? null,
  });
  if (error) return apiError(500, journalDbMessage(error.code));
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const { supabase, unauthorized, user } = await requireUser();
  if (!user) return unauthorized;
  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "Тело запроса не является JSON"); }
  const parsed = updateBody.safeParse(body);
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "Неверные данные журнала");
  const v = parsed.data;

  if (v.operation === "update-action") {
    // .select() обязателен: RLS отрезает чужую строку молча, и update без
    // возврата строк неотличим от успешного. Интерфейс показал бы «сохранено»
    // там, где не сохранено ничего
    const { data: updated, error } = await supabase.from("gm_level_actions").update({
      drop_percent: v.dropPercent, kind: v.kind, gm_amount: v.gmAmount,
      funds_source: v.fundsSource, asset_amount: v.assetAmount ?? null,
      usd_amount: v.usdAmount ?? null, asset_price_usd: v.assetPriceUsd ?? null,
      happened_at: v.happenedAt, note: v.note ?? null,
    }).eq("id", v.id).select("id");
    if (error) return apiError(500, journalDbMessage(error.code));
    if (!updated || updated.length === 0) {
      return apiError(404, "Операция не найдена");
    }
    return NextResponse.json({ ok: true });
  }

  // Историческую точку не переписывают: так можно незаметно исказить старый
  // цикл. Ручное поле разметки имеет право менять только текущую запись.
  const { data: point, error: pointError } = await supabase
    .from("gm_reference_points")
    .select("id, protocol, chain, external_id")
    .eq("id", v.id).maybeSingle();
  if (pointError) return apiError(500, "Не удалось прочитать точку отсчёта");
  if (!point) return apiError(404, "Точка отсчёта не найдена");
  const { data: current, error: currentError } = await supabase
    .from("gm_reference_points")
    .select("id")
    .eq("protocol", point.protocol).eq("chain", point.chain).eq("external_id", point.external_id)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (currentError) return apiError(500, "Не удалось прочитать текущую точку отсчёта");
  if (!current || current.id !== v.id) return apiError(409, "Можно править только текущую точку отсчёта");
  const { error } = await supabase.from("gm_reference_points")
    .update({ price_usd: v.priceUsd, note: v.note ?? null }).eq("id", v.id);
  if (error) return apiError(500, journalDbMessage(error.code));
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;
  const kind = request.nextUrl.searchParams.get("kind");
  const id = request.nextUrl.searchParams.get("id");
  if ((kind !== "action" && kind !== "reference") || !id || !z.string().uuid().safeParse(id).success) {
    return apiError(400, "Неверный идентификатор записи журнала");
  }
  const table = kind === "action" ? "gm_level_actions" : "gm_reference_points";
  if (kind === "reference") {
    const { data: point, error: pointError } = await supabase
      .from("gm_reference_points").select("id, protocol, chain, external_id")
      .eq("id", id).maybeSingle();
    if (pointError) return apiError(500, "Не удалось прочитать точку отсчёта");
    if (!point) return apiError(404, "Точка отсчёта не найдена");
    const { data: current, error: currentError } = await supabase
      .from("gm_reference_points").select("id")
      .eq("protocol", point.protocol).eq("chain", point.chain).eq("external_id", point.external_id)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(1).maybeSingle();
    if (currentError) return apiError(500, "Не удалось прочитать текущую точку отсчёта");
    if (current?.id !== id) return apiError(409, "Удалить можно только последнюю точку отсчёта");
  }
  // Тот же .select(), что и у правки: без него удаление уже удалённой или
  // чужой строки отвечает «ок» и интерфейс перечитывает неизменные данные
  const { data: removed, error } = await supabase.from(table).delete().eq("id", id).select("id");
  if (error) return apiError(error.code === "23503" ? 409 : 500, journalDbMessage(error.code));
  if (!removed || removed.length === 0) {
    return apiError(404, kind === "action" ? "Операция не найдена" : "Точка отсчёта не найдена");
  }
  return NextResponse.json({ ok: true });
}
