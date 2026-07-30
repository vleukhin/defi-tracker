"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200";

const registerSchema = z
  .object({
    email: z.email("Введите корректный email."),
    password: z.string().min(8, "Пароль должен быть не короче 8 символов."),
    passwordConfirm: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Пароли не совпадают.",
    path: ["passwordConfirm"],
  });

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = registerSchema.safeParse({ email, password, passwordConfirm });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте введенные данные.");
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    setPending(false);

    if (signUpError) {
      setError(
        signUpError.code === "user_already_exists"
          ? "Пользователь с таким email уже зарегистрирован."
          : "Не удалось зарегистрироваться. Попробуйте еще раз.",
      );
      return;
    }

    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-medium">Проверьте почту</h2>
        <p className="text-sm text-gray-600">
          Мы отправили письмо на <span className="font-medium">{email}</span>.
          Перейдите по ссылке в письме, чтобы подтвердить адрес, затем войдите.
        </p>
        <Link
          href="/login"
          className="block text-center text-sm text-gray-600 hover:underline"
        >
          Ко входу
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-lg font-medium">Регистрация</h2>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>

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
        {pending ? "Регистрация…" : "Зарегистрироваться"}
      </button>

      <p className="text-center text-sm text-gray-600">
        Уже есть аккаунт?{" "}
        <Link href="/login" className="hover:underline">
          Войти
        </Link>
      </p>
    </form>
  );
}
