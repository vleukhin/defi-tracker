"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200";

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
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    setPending(false);

    if (updateError) {
      setError(
        updateError.code === "same_password"
          ? "Новый пароль должен отличаться от старого."
          : "Не удалось обновить пароль. Запросите сброс еще раз.",
      );
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-lg font-medium">Новый пароль</h2>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-medium">
          Пароль
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="passwordConfirm" className="block text-sm font-medium">
          Пароль еще раз
        </label>
        <input
          id="passwordConfirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? "Сохранение…" : "Сохранить пароль"}
      </button>
    </form>
  );
}
