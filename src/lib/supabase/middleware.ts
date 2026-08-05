import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { verifiedUser } from "./session";
import { supabaseUrl } from "./url";

/** Пути, доступные без авторизации. */
const PUBLIC_PATHS = ["/login", "/reset-password", "/auth"];

/**
 * API-роуты, не требующие пользовательской сессии.
 *
 * /api/health — health-чек для мониторинга.
 * /api/cron/* — джобы Vercel Cron: они ходят без куки, и без этого исключения
 *   молча не отрабатывали бы никогда (401 от прокси). Роуты не «открытые»:
 *   каждый сам требует Authorization: Bearer CRON_SECRET.
 *
 * Список именно префиксный, а не перечень точных путей. Перечень уже подвёл:
 * при добавлении /api/cron/health его забыли внести, и мониторинг health
 * factor — тот, что по стратегии главный индикатор риска, — молча получал
 * 401 каждые 15 минут. Новый cron-роут не должен требовать правки в двух
 * местах, чтобы работать.
 */
const PUBLIC_API_PATHS = ["/api/health"];
const PUBLIC_API_PREFIXES = ["/api/cron/"];

export function isPublicApi(pathname: string) {
  return (
    PUBLIC_API_PATHS.includes(pathname) ||
    PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))
  );
}

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Обновляет сессию Supabase (refresh токенов через куки) и защищает
 * приложение: неавторизованный пользователь редиректится на /login.
 * Вызывается из src/proxy.ts на каждый запрос.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // ВАЖНО: не вставлять логику между createServerClient и проверкой сессии —
  // иначе возможны случайные разлогины (см. документацию @supabase/ssr).
  // Проверка локальная, по подписи токена (см. session.ts): прокси стоит на
  // пути КАЖДОГО запроса, и сетевой вызов Auth здесь дороже всего остального.
  // Обновление истекающего токена getClaims делает сам, куки не теряются.
  const user = await verifiedUser(supabase);

  const { pathname } = request.nextUrl;

  // API: не редиректить на /login, а отвечать 401 JSON
  // (роуты дополнительно проверяют сессию сами — защита в глубину).
  if (pathname.startsWith("/api")) {
    if (!user && !isPublicApi(pathname)) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    return supabaseResponse;
  }

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Возвращать именно supabaseResponse, чтобы куки сессии не потерялись.
  return supabaseResponse;
}
