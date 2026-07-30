import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSnapshot, refreshUserWallets } from "@/lib/portfolio/snapshot";

/**
 * GET /api/cron/snapshot — ежедневный снепшот всех пользователей (S3.1).
 *
 * Метод GET, потому что Vercel Cron умеет только GET-запросы.
 *
 * Защита: заголовок `Authorization: Bearer ${CRON_SECRET}`. Роут открыт
 * в интернет, а работает под service-role — без секрета любой желающий
 * гонял бы RPC и CoinGecko от нашего имени. Заголовок `x-vercel-cron`
 * учитывается только как диагностический признак: подделать его тривиально,
 * поэтому секрет требуется в любом случае.
 *
 * Бюджет времени. Функция на Vercel Hobby ограничена ~60 секундами, а работа
 * линейна по числу пользователей (4 RPC-мультиколла на кошелек + один поход
 * в CoinGecko). Поэтому: пользователи обрабатываются ПОСЛЕДОВАТЕЛЬНО (веер
 * упрется в лимиты провайдеров), а по исчерпании мягкого бюджета чтение
 * блокчейна для оставшихся пропускается — снепшот им все равно снимается,
 * по последним известным данным залога и с пометкой «частичный», как и
 * требует S3.1 при недоступности сети. Пропустить точку истории хуже, чем
 * снять ее по кэшу. Если пользователей станет много, следующий шаг —
 * очередь (по одному вызову на пользователя), а не рост таймаута.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Порог, после которого оставшимся пользователям снепшот снимается по кэшу. */
const RPC_BUDGET_MS = 40_000;

const USERS_PAGE_SIZE = 200;

/**
 * Сравнение секретов постоянным временем. timingSafeEqual требует равной
 * длины, поэтому сравниваются sha256-дайджесты: длина у них всегда одна,
 * и сама длина секрета не утекает.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

interface UserResult {
  userId: string;
  ok: boolean;
  error?: string;
  isPartial: boolean;
  /** Пропущено чтение блокчейна из-за исчерпанного бюджета времени. */
  skippedRefresh?: boolean;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Отсутствие секрета — ошибка конфигурации, а не повод пустить запрос
    console.error("[cron] CRON_SECRET не задан — запрос отклонен");
    return apiError(500, "CRON_SECRET не настроен");
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !secretMatches(token, expected)) {
    return apiError(401, "Не авторизован");
  }

  const admin = createAdminClient();

  // Все пользователи: снепшоты снимаются каждому, у кого есть данные
  const userIds: string[] = [];
  try {
    for (let page = 1; ; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: USERS_PAGE_SIZE,
      });
      if (error) throw new Error(error.message);
      userIds.push(...data.users.map((u) => u.id));
      if (data.users.length < USERS_PAGE_SIZE) break;
    }
  } catch (err) {
    return apiError(
      500,
      `Не удалось получить список пользователей: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const users: UserResult[] = [];

  for (const userId of userIds) {
    const budgetLeft = Date.now() - startedAt < RPC_BUDGET_MS;
    try {
      if (budgetLeft) {
        const refresh = await refreshUserWallets(admin, userId);
        if (refresh.failed > 0) {
          // Не ошибка прогона: снепшот снимется по последним известным данным
          console.warn(
            `[cron] ${userId}: кошельки с ошибкой — ${refresh.errors.join("; ")}`,
          );
        }
      }

      const { snapshot, partialReasons } = await createSnapshot(
        admin,
        admin,
        userId,
        { readerScope: "admin" },
      );
      if (partialReasons.length > 0) {
        console.warn(
          `[cron] ${userId}: снепшот частичный — ${partialReasons.join("; ")}`,
        );
      }

      users.push({
        userId,
        ok: true,
        isPartial: snapshot.isPartial,
        ...(budgetLeft ? {} : { skippedRefresh: true }),
      });
    } catch (err) {
      // Падение одного пользователя не отменяет остальных
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron] ${userId}: снепшот не снят — ${message}`);
      users.push({ userId, ok: false, error: message, isPartial: false });
    }
  }

  return NextResponse.json({
    ran: users.length,
    users,
    durationMs: Date.now() - startedAt,
  });
}
