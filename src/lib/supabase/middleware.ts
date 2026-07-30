import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Пути, доступные без авторизации. */
const PUBLIC_PATHS = ["/login", "/register", "/reset-password", "/auth"];

/** API-роуты без авторизации (health-чек для мониторинга). */
const PUBLIC_API_PATHS = ["/api/health"];

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
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
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

  // ВАЖНО: не вставлять логику между createServerClient и getUser() —
  // иначе возможны случайные разлогины (см. документацию @supabase/ssr).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // API: не редиректить на /login, а отвечать 401 JSON
  // (роуты дополнительно проверяют сессию сами — защита в глубину).
  if (pathname.startsWith("/api")) {
    if (!user && !PUBLIC_API_PATHS.includes(pathname)) {
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

  if (user && (pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Возвращать именно supabaseResponse, чтобы куки сессии не потерялись.
  return supabaseResponse;
}
