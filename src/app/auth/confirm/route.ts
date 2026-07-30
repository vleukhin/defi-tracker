import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Обработка ссылок из писем (подтверждение email, сброс пароля).
 * Шаблоны писем (supabase/templates/*) ведут сюда с token_hash + type.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextParam = searchParams.get("next") ?? "/";
  // Только относительные внутренние пути — защита от open redirect
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//")
    ? nextParam
    : "/";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      redirect(next);
    }
  }

  redirect("/login?error=confirm");
}
