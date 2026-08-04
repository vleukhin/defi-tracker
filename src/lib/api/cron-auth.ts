import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "./auth";

/**
 * Защита cron-роутов общим секретом (CRON_SECRET).
 *
 * Роуты работают под service-role и открыты в интернет: без секрета любой
 * желающий гонял бы RPC и внешние API от нашего имени, а роут мониторинга —
 * ещё и слал бы уведомления. Заголовок `x-vercel-cron` доказательством не
 * считается: подделать его тривиально.
 *
 * Живёт отдельным модулем, потому что роутов стало два: скопированная
 * проверка секрета расходится ровно тогда, когда её чинят в одном месте.
 */

/**
 * Сравнение постоянным временем. timingSafeEqual требует равной длины,
 * поэтому сравниваются sha256-дайджесты: длина у них всегда одна, и сама
 * длина секрета не утекает.
 */
export function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Проверяет `Authorization: Bearer <CRON_SECRET>`.
 * Возвращает готовый ответ при отказе и null при успехе.
 */
export function checkCronSecret(request: NextRequest): NextResponse | null {
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
  return null;
}
