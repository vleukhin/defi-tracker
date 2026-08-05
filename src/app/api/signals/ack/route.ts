import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import type { SignalAcksResponseDto } from "@/lib/api/types";

/**
 * Отметки «действие по сигналу выполнено» (лента «Что делать сейчас»).
 *
 * GET — все отметки пользователя, PUT — поставить или снять одну.
 *
 * Приложение видит цену и состав пула, но не видит, продал ли владелец GM
 * на уровне: продажа 30% меняет стоимость позиции ровно так же, как её
 * меняет падение цены. Вывести факт действия из данных нельзя — его можно
 * только сказать, и эта ручка ровно для этого.
 *
 * ЧТО МОЖНО ОТМЕЧАТЬ, решает не клиент, а префикс ключа. Отмечаются уровни
 * GM и вышедший срок CLMM — там, где стратегия предписывает разовую
 * операцию. Риск ликвидации не отмечается вовсе: HF — состояние, а не
 * задача, и разрешить его скрыть значило бы разрешить не видеть
 * единственный сценарий, способный принудительно прервать накопление.
 * Гигиена данных гаснет сама, когда данные починены; отметка на «нет
 * разметки» прятала бы проблему вместо решения.
 *
 * Отпечаток обстановки клиент передаёт вместе с ключом — он же его и
 * считает при сборке сигнала. Сервер отпечаток не проверяет: чтобы
 * посчитать его самому, роуту пришлось бы собрать всю ленту целиком,
 * а расхождение в расчёте между ним и клиентом стоило бы дороже
 * любой пользы от проверки. Ошибка здесь безобидна: отметка просто
 * не совпадёт с обстановкой, и сигнал останется в ленте.
 */

/** Виды сигналов, у которых отметка осмысленна (см. миграцию 200). */
const ACKABLE_PREFIXES = ["gm-level:", "gm-growth:", "clmm-ready:"] as const;

const bodySchema = z.object({
  signalKey: z.string().min(1).max(200),
  /** Обстановка на момент отметки; null = снять отметку. */
  fingerprint: z.string().min(1).max(100).nullable(),
});

export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const { data, error } = await supabase
    .from("signal_acks")
    .select("signal_key, fingerprint, acked_at");
  if (error) return apiError(500, error.message);

  const response: SignalAcksResponseDto = {
    acks: (data ?? []).map((row) => ({
      signalKey: row.signal_key as string,
      fingerprint: row.fingerprint as string,
      ackedAt: row.acked_at as string,
    })),
  };
  return NextResponse.json(response);
}

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
      parsed.error.issues[0]?.message ?? "Неверные данные отметки",
    );
  }
  const { signalKey, fingerprint } = parsed.data;

  if (!ACKABLE_PREFIXES.some((prefix) => signalKey.startsWith(prefix))) {
    return apiError(400, "Этот сигнал не отмечается выполненным");
  }

  if (fingerprint === null) {
    const { error } = await supabase
      .from("signal_acks")
      .delete()
      .eq("signal_key", signalKey);
    if (error) return apiError(500, error.message);
    return NextResponse.json({ ok: true, acked: false });
  }

  // Повторная отметка того же ключа с новой обстановкой перезаписывает
  // строку: у ключа ровно одно актуальное решение
  const { error } = await supabase.from("signal_acks").upsert(
    {
      user_id: user.id,
      signal_key: signalKey,
      fingerprint,
      acked_at: new Date().toISOString(),
    },
    { onConflict: "user_id,signal_key" },
  );
  if (error) return apiError(500, error.message);

  return NextResponse.json({ ok: true, acked: true });
}
