"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${window.location.origin}/reset-password/update` },
    );
    setPending(false);

    if (resetError) {
      setError("Не удалось отправить письмо. Попробуйте еще раз.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-medium">Проверьте почту</h2>
        <p className="text-sm text-gray-600">
          Если аккаунт с адресом <span className="font-medium">{email}</span>{" "}
          существует, мы отправили ссылку для сброса пароля.
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
      <h2 className="text-lg font-medium">Сброс пароля</h2>
      <p className="text-sm text-gray-600">
        Укажите email — мы пришлем ссылку для установки нового пароля.
      </p>

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

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? "Отправка…" : "Отправить ссылку"}
      </button>

      <Link
        href="/login"
        className="block text-center text-sm text-gray-600 hover:underline"
      >
        Ко входу
      </Link>
    </form>
  );
}
