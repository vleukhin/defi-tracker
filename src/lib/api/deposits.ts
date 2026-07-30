import "server-only";
import { z } from "zod";
import type { DepositDto } from "./types";

/**
 * Общее для роутов /api/deposits: zod-схема записи журнала «Внесено» (S4.0)
 * и маппинг строки БД в DTO.
 *
 * amount ПОДПИСАННАЯ: положительная — пополнение собственными деньгами,
 * отрицательная — вывод собственных средств. Ноль запрещен. Заемные средства
 * в журнал не попадают никогда (методика Фазы 4).
 *
 * Числа принимаются строкой ИЛИ числом, запятая толерантно заменяется на
 * точку; наружу суммы отдаются строками — не гонять numeric через float.
 */

/** Подписанное десятичное число строкой или числом; запятая → точка. */
const signedDecimalInput = (label: string) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => String(v).trim().replace(",", "."))
    .refine((v) => /^-?\d+(\.\d+)?$/.test(v), `${label} должно быть числом`);

/** Сегодняшний календарный день UTC, YYYY-MM-DD. */
function todayUtc(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export const depositSchema = z.object({
  amount: signedDecimalInput("Сумма").refine((v) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) && n !== 0;
  }, "Сумма не может быть нулевой"),
  happenedOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД")
    .refine(
      (v) => Number.isFinite(Date.parse(`${v}T00:00:00.000Z`)),
      "Дата нечитаема",
    )
    // Сравнение строк корректно для ISO-дат; «сегодня» — валидно
    .refine(
      (v) => v <= todayUtc(Date.now()),
      "Дата не может быть в будущем",
    ),
  note: z
    .string()
    .trim()
    .max(200, "Заметка не длиннее 200 символов")
    .nullish()
    .transform((v) => (v ? v : null)),
});

export type DepositInput = z.infer<typeof depositSchema>;

/** Колонки для select — единый список во всех роутах. */
export const DEPOSIT_COLUMNS = "id, amount, happened_on, note, created_at";

export interface DepositRow {
  id: string;
  amount: number | string;
  happened_on: string;
  note: string | null;
  created_at: string;
}

export function mapDepositRow(row: DepositRow): DepositDto {
  return {
    id: row.id,
    amount: String(row.amount),
    happenedOn: row.happened_on,
    note: row.note,
    createdAt: row.created_at,
  };
}

/** Поля insert/update из провалидированного входа. */
export function toDepositColumns(input: DepositInput) {
  return {
    amount: input.amount,
    happened_on: input.happenedOn,
    note: input.note,
  };
}

/**
 * «Внесено» — подписанная сумма всего журнала. Считается по всем записям,
 * никогда по странице: вывод средств (минус) обязан уменьшать итог.
 */
export function sumDeposits(rows: Pick<DepositRow, "amount">[]): number {
  return rows.reduce((sum, r) => sum + Number(r.amount), 0);
}
