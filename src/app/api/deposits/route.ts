import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireUser } from "@/lib/api/auth";
import {
  DEPOSIT_COLUMNS,
  depositSchema,
  mapDepositRow,
  sumDeposits,
  toDepositColumns,
  type DepositRow,
} from "@/lib/api/deposits";

/**
 * Журнал «Внесено» (Фаза 4, S4.0): собственные деньги, заведенные извне.
 * История пополнений и выводов, а не одно число — иначе нельзя ни проверить,
 * ни исправить прошлое.
 *
 * GET /api/deposits — { deposits, summary: { totalDeposited } },
 * записи новыми вперед (happened_on desc). totalDeposited — подписанная
 * сумма ВСЕГО журнала: выводы (отрицательные записи) уменьшают «Внесено».
 */
export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { data, error } = await supabase
    .from("deposits")
    .select(DEPOSIT_COLUMNS)
    .order("happened_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return apiError(500, error.message);

  const rows = (data ?? []) as DepositRow[];
  return NextResponse.json({
    deposits: rows.map(mapDepositRow),
    summary: { totalDeposited: sumDeposits(rows) },
  });
}

/** POST /api/deposits — записать пополнение/вывод; 201 с созданной строкой. */
export async function POST(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Невалидный JSON");
  }
  const parsed = depositSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Невалидные данные", {
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  const { data, error } = await supabase
    .from("deposits")
    .insert({ user_id: user.id, ...toDepositColumns(parsed.data) })
    .select(DEPOSIT_COLUMNS)
    .single();
  if (error) return apiError(500, error.message);

  return NextResponse.json(
    { deposit: mapDepositRow(data as DepositRow) },
    { status: 201 },
  );
}
