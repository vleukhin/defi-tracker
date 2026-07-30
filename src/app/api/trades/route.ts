import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import {
  TRADE_COLUMNS,
  mapTradeRow,
  toLedgerTrade,
  toTradeColumns,
  tradeSchema,
  type TradeRow,
} from "@/lib/api/trades";
import { replayTrades } from "@/lib/portfolio/ledger";
import { PORTFOLIO_CATEGORIES } from "@/lib/portfolio/portfolio";

/**
 * Журнал сделок (Фаза 2, S2.1): ручные покупки/продажи по трем категориям.
 *
 * GET /api/trades[?category=&from=&to=&q=&page=&pageSize=]
 *   { trades, summary, page } — список постранично и новыми вперед.
 *
 * ВАЖНО: summary (средняя, realized P/L, предупреждения) считается реплеем
 * по ВСЕМ сделкам пользователя и не зависит ни от фильтров, ни от страницы.
 * Средняя цена — свойство всего леджера: посчитать ее по видимой странице
 * значило бы показывать заведомо неверное число.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const querySchema = z.object({
  category: z.enum(PORTFOLIO_CATEGORIES).nullish(),
  /** Границы периода включительно, YYYY-MM-DD. */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата «с» в формате ГГГГ-ММ-ДД")
    .nullish(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата «по» в формате ГГГГ-ММ-ДД")
    .nullish(),
  /** Подстрока заметки. */
  q: z
    .string()
    .trim()
    .max(100, "Строка поиска не длиннее 100 символов")
    .nullish()
    .transform((v) => (v ? v : null)),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .catch(DEFAULT_PAGE_SIZE),
});

/**
 * Экранирование подстроки поиска: `%`, `_` и `*` — метасимволы шаблона
 * (PostgREST превращает `*` в `%`). Пользователь ищет текст, а не пишет
 * шаблон, поэтому метасимволы выкусываются, а не интерпретируются.
 */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[%_*\\]/g, " ").trim();
}

export async function GET(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const sp = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    category: sp.get("category"),
    from: sp.get("from"),
    to: sp.get("to"),
    q: sp.get("q"),
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return apiError(400, "Некорректные параметры фильтра", {
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }
  const { category, from, to, q, page, pageSize } = parsed.data;

  // 1) Реплей — всегда по всем сделкам, минимальный набор колонок
  const { data: allRows, error: allError } = await supabase
    .from("trades")
    .select("category, side, quantity, price_usd, traded_at, created_at");
  if (allError) return apiError(500, allError.message);
  const summary = replayTrades((allRows ?? []).map((r) => toLedgerTrade(r as TradeRow)));

  // 2) Страница списка — с фильтрами и точным общим количеством
  let query = supabase
    .from("trades")
    .select(TRADE_COLUMNS, { count: "exact" })
    .order("traded_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (category) query = query.eq("category", category);
  // Границы включительно: сделки хранятся на полночь UTC
  if (from) query = query.gte("traded_at", `${from}T00:00:00.000Z`);
  if (to) query = query.lte("traded_at", `${to}T23:59:59.999Z`);
  if (q) {
    const needle = sanitizeSearch(q);
    if (needle) query = query.ilike("note", `%${needle}%`);
  }

  const offset = (page - 1) * pageSize;
  const { data, error, count } = await query.range(offset, offset + pageSize - 1);
  if (error) return apiError(500, error.message);

  const total = count ?? 0;
  return NextResponse.json({
    trades: ((data ?? []) as TradeRow[]).map(mapTradeRow),
    summary,
    page: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
}

/** POST /api/trades — записать сделку; 201 с созданной строкой. */
export async function POST(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Невалидный JSON");
  }
  const parsed = tradeSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Невалидные данные", {
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  const { data, error } = await supabase
    .from("trades")
    .insert({ user_id: user.id, ...toTradeColumns(parsed.data) })
    .select(TRADE_COLUMNS)
    .single();
  if (error) return apiError(500, error.message);

  return NextResponse.json({ trade: mapTradeRow(data as TradeRow) }, { status: 201 });
}
