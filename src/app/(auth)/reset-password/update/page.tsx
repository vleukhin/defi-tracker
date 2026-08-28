"use client";

import { CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const schema = z
  .object({
    password: z.string().min(8, "Пароль должен быть не короче 8 символов."),
    passwordConfirm: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Пароли не совпадают.",
    path: ["passwordConfirm"],
  });

/**
 * Установка нового пароля. Пользователь попадает сюда по ссылке из письма
 * (через /auth/confirm с type=recovery, уже с recovery-сессией).
 */
export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = schema.safeParse({ password, passwordConfirm });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте введенные данные.");
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password: parsed.data.password,
      });

      if (updateError) {
        setError(
          updateError.code === "same_password"
            ? "Новый пароль должен отличаться от старого."
            : "Не удалось обновить пароль. Запросите сброс ещё раз.",
        );
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Не удалось связаться с сервером. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h1 className="t-h2">Новый пароль</h1>

      {error && (
        <Alert variant="destructive" role="alert" className="py-2.5">
          <CircleAlert className="size-4" />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="password">Пароль</Label>
        <PasswordInput
          id="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
          className="h-11"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="passwordConfirm">Пароль еще раз</Label>
        <PasswordInput
          id="passwordConfirm"
          required
          minLength={8}
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          disabled={pending}
          className="h-11"
        />
      </div>

      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? "Сохранение…" : "Сохранить пароль"}
      </Button>
    </form>
  );
}
