"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ linkError }: { linkError?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    linkError ? "Ссылка недействительна или устарела. Войдите заново." : null,
  );
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        if (signInError.code === "email_not_confirmed") {
          setError("Email не подтверждён. Проверьте почту и перейдите по ссылке.");
        } else if (signInError.code === "invalid_credentials") {
          setError("Неверный email или пароль.");
        } else {
          setError("Не удалось войти. Попробуйте ещё раз.");
        }
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
      <h1 className="t-h2">Вход</h1>

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
          disabled={pending}
          className="h-11"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Пароль</Label>
        <PasswordInput
          id="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
          className="h-11"
        />
      </div>

      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? "Вход…" : "Войти"}
      </Button>

      <div className="flex justify-end text-sm">
        <Link
          href="/reset-password"
          className="text-link underline-offset-4 hover:underline"
        >
          Забыли пароль?
        </Link>
      </div>
    </form>
  );
}
