import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16: файл proxy.ts заменяет middleware.ts.
 * Обновляет сессию Supabase и защищает роуты приложения.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Все пути, кроме:
     * - _next/static, _next/image (статика Next.js)
     * - favicon.ico и файлов изображений
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
