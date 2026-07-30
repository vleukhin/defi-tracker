import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Выход из аккаунта (POST, чтобы исключить CSRF через GET-переход). */
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
