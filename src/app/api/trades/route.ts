import { NextResponse, type NextRequest } from "next/server";
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
import {
  PORTFOLIO_CATEGORIES,
  type PortfolioCategory,
} from "@/lib/portfolio/portfolio";

/**
 * Журнал сделок (Фаза 2, S2.1): ручные покупки/продажи по трем категориям.
 *
 * GET /api/trades[?category=btc|eth|stable]
 *   { trades, summary } — сделки новыми вперед; summary — итог реплея
 *   (средняя, realized P/L, комиссии, предупреждения) ВСЕГДА по всем трем
 *   категориям: реплей независим по категориям и дешев, а фронтенду не
 *   нужен второй запрос; ?category= сужает только список сделок.
 */
export async function GET(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const categoryParam = request.nextUrl.searchParams.get("category");
  if (
    categoryParam !== null &&
    !(PORTFOLIO_CATEGORIES as readonly string[]).includes(categoryParam)
  ) {
    return apiError(400, "Неизвестная категория", {
      allowed: PORTFOLIO_CATEGORIES,
    });
  }

  const { data, error } = await supabase
    .from("trades")
    .select(TRADE_COLUMNS)
    .order("traded_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return apiError(500, error.message);

  const rows = (data ?? []) as TradeRow[];
  const summary = replayTrades(rows.map(toLedgerTrade));

  const filtered = categoryParam
    ? rows.filter((r) => r.category === (categoryParam as PortfolioCategory))
    : rows;

  return NextResponse.json({
    trades: filtered.map(mapTradeRow),
    summary,
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
