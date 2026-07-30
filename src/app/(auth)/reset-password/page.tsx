"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

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
        <p className="text-sm text-muted-foreground">
          Если аккаунт с адресом <span className="font-medium">{email}</span>{" "}
          существует, мы отправили ссылку для сброса пароля.
        </p>
        <Link
          href="/login"
          className="block text-center text-sm text-link underline-offset-4 hover:underline"
        >
          Ко входу
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-lg font-medium">Сброс пароля</h2>
      <p className="text-sm text-muted-foreground">
        Укажите email — мы пришлем ссылку для установки нового пароля.
      </p>

      {error && (
        <Alert variant="destructive" role="alert" className="py-2.5">
          <CircleAlert className="size-4" />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-10"
        />
      </div>

      <Button type="submit" disabled={pending} className="h-10 w-full">
        {pending ? "Отправка…" : "Отправить ссылку"}
      </Button>

      <Link
        href="/login"
        className="block text-center text-sm text-link underline-offset-4 hover:underline"
      >
        Ко входу
      </Link>
    </form>
  );
}
