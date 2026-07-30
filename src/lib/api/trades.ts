import "server-only";
import { z } from "zod";
import { PORTFOLIO_CATEGORIES } from "@/lib/portfolio/portfolio";
import type { LedgerTrade } from "@/lib/portfolio/ledger";
import type { TradeDto } from "./types";

/**
 * Общее для роутов /api/trades: zod-схема сделки и маппинг строки БД в DTO.
 *
 * Числа принимаются строкой ИЛИ числом (как в manual-роуте), запятая
 * толерантно заменяется на точку; наружу количества и цены отдаются
 * строками — не гонять numeric через float.
 */

/** Десятичное число строкой или числом; запятая → точка. */
const decimalInput = (label: string) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => String(v).trim().replace(",", "."))
    .refine((v) => /^\d+(\.\d+)?$/.test(v), `${label} должно быть числом`);

/** Конец СЕГОДНЯШНИХ суток UTC: сделки «сегодня» валидны, будущее — нет. */
function endOfTodayUtcMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export const tradeSchema = z.object({
  category: z.enum(PORTFOLIO_CATEGORIES),
  side: z.enum(["buy", "sell"]),
  quantity: decimalInput("Количество").refine((v) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) && n > 0;
  }, "Количество должно быть больше нуля"),
  // Регекс уже запрещает минус; refine отсекает переполнение float
  priceUsd: decimalInput("Цена").refine(
    (v) => Number.isFinite(Number.parseFloat(v)),
    "Цена должна быть числом",
  ),
  tradedAt: z
    .string()
    .trim()
    .refine((v) => Number.isFinite(Date.parse(v)), "Дата сделки нечитаема")
    .transform((v) => new Date(Date.parse(v)).toISOString())
    .refine(
      (v) => Date.parse(v) < endOfTodayUtcMs(Date.now()),
      "Дата сделки не может быть в будущем",
    ),
  note: z
    .string()
    .trim()
    .max(200, "Заметка не длиннее 200 символов")
    .nullish()
    .transform((v) => (v ? v : null)),
});

export type TradeInput = z.infer<typeof tradeSchema>;

/** Колонки для select — единый список во всех роутах. */
export const TRADE_COLUMNS =
  "id, category, side, quantity, price_usd, traded_at, note, created_at";

export interface TradeRow {
  id: string;
  category: string;
  side: string;
  quantity: number | string;
  price_usd: number | string;
  traded_at: string;
  note: string | null;
  created_at: string;
}

export function mapTradeRow(row: TradeRow): TradeDto {
  return {
    id: row.id,
    category: row.category as TradeDto["category"],
    side: row.side as TradeDto["side"],
    quantity: String(row.quantity),
    priceUsd: String(row.price_usd),
    tradedAt: row.traded_at,
    note: row.note,
    createdAt: row.created_at,
  };
}

/** Вход движка реплея из строки БД. */
export function toLedgerTrade(row: TradeRow): LedgerTrade {
  return {
    category: row.category as LedgerTrade["category"],
    side: row.side as LedgerTrade["side"],
    quantity: String(row.quantity),
    priceUsd: String(row.price_usd),
    tradedAt: row.traded_at,
    createdAt: row.created_at,
  };
}

/** Поля insert/update из провалидированного входа. */
export function toTradeColumns(input: TradeInput) {
  return {
    category: input.category,
    side: input.side,
    quantity: input.quantity,
    price_usd: input.priceUsd,
    traded_at: input.tradedAt,
    note: input.note,
  };
}
