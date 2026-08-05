import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import { CHAIN_IDS, type ChainId } from "@/lib/chains/config";
import { TOKEN_ALLOWLIST } from "@/lib/chains/allowlist";

/**
 * PUT /api/balances/mark — разметка свободных средств кошелька: свои
 * или заемные (Фаза 7).
 *
 * Адресуется натуральным ключом (кошелек, сеть, токен), а не id строки
 * balances_cache: читатель перезаписывает кэш и удаляет нулевые балансы.
 * По id пометка «заемные» терялась бы при каждом опустошении баланса.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ READ-MERGE, В ОТЛИЧИЕ ОТ /api/positions/mark. Там PUT
 * правит подмножество из пяти независимых полей, и слияние с текущей
 * строкой обязательно, иначе правка зоны затерла бы вложенные суммы.
 * Здесь поле одно: funds = null означает «снять разметку» и выполняет
 * delete, любое другое значение — upsert. Читать перед записью нечего.
 *
 * Отсутствие строки = «не размечено», и это не ноль и не own: такой баланс
 * считается своим в категориях, но выводится отдельным числом.
 */

const bodySchema = z.object({
  walletId: z.guid(),
  chain: z.enum(CHAIN_IDS),
  // 'native' — монета сети; иначе адрес контракта (регистр приводится ниже)
  token: z.string().min(1).max(64),
  funds: z.enum(["own", "borrowed"]).nullable(),
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
  const { walletId, chain, funds } = parsed.data;
  const token = parsed.data.token.toLowerCase();

  if (token !== "native" && !/^0x[0-9a-f]{40}$/.test(token)) {
    return apiError(400, "Токен: «native» или адрес контракта");
  }
  // Токен, которого приложение не читает, разметить нельзя: строка осталась
  // бы висеть навсегда и ни на что не влиять — почти наверняка это опечатка
  if (
    token !== "native" &&
    !TOKEN_ALLOWLIST[chain as ChainId].some((t) => t.address === token)
  ) {
    return apiError(400, `Токен ${token} не читается в сети ${chain}`);
  }

  // Владение кошельком проверяется ЯВНО. RLS на balance_marks сверяет только
  // user_id, а wallet_id не проверяет: без этой выборки можно было бы
  // завести пометку на чужой кошелек — внешний ключ такое пропустит.
  // Чужой кошелек RLS уже отрезала, поэтому пустой ответ = «не найден».
  const { data: owned, error: walletError } = await supabase
    .from("wallets")
    .select("id")
    .eq("id", walletId)
    .maybeSingle();
  if (walletError) return apiError(500, walletError.message);
  if (!owned) return apiError(404, "Кошелёк не найден");

  if (funds === null) {
    const { error } = await supabase
      .from("balance_marks")
      .delete()
      .eq("wallet_id", walletId)
      .eq("chain", chain)
      .eq("token", token);
    if (error) return apiError(500, error.message);
    return NextResponse.json({ ok: true, funds: null });
  }

  const { error } = await supabase.from("balance_marks").upsert(
    {
      user_id: user.id,
      wallet_id: walletId,
      chain,
      token,
      funds,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,wallet_id,chain,token" },
  );
  if (error) return apiError(500, error.message);

  return NextResponse.json({ ok: true, funds });
}
