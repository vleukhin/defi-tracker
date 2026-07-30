"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, ApiError } from "@/lib/use-api";

type AdminUser = {
  id: string;
  email: string | undefined;
  role: "admin" | "user";
  createdAt: string;
  lastSignInAt: string | null;
};

/**
 * Управление пользователями — видно только администратору (страница
 * рендерит компонент условно; API дополнительно проверяет роль, 403 иначе).
 * Дизайн §5.4: успех — тостом, ошибка — инлайн; удаление — AlertDialog.
 */
export function UsersManager({ selfId }: { selfId: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<{ users: AdminUser[] }>("/api/admin/users")
      .then((r) => setUsers(r.users))
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      toast.success(`Пользователь ${email} создан`);
      setEmail("");
      setPassword("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(user: AdminUser) {
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      toast.success(`Пользователь ${user.email} удален`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить");
    }
  }

  return (
    <Card className="p-0">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Пользователи</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Публичной регистрации нет — аккаунты создает администратор. Email
          нового пользователя считается подтвержденным сразу.
        </p>
      </div>

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-2 px-4 py-3 sm:flex-row"
      >
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          aria-label="Email нового пользователя"
          className="flex-1"
        />
        <Input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль (мин. 8 символов)"
          aria-label="Пароль нового пользователя"
          className="flex-1"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Создание…" : "Создать"}
        </Button>
      </form>

      {error && (
        <p className="px-4 pb-2 text-sm text-destructive" role="status">
          {error}
        </p>
      )}

      <ul className="divide-y divide-border border-t border-border">
        {users === null && (
          <li className="px-4 py-3 text-xs text-muted-foreground">Загрузка…</li>
        )}
        {users?.map((u) => (
          <li
            key={u.id}
            className="flex items-center justify-between gap-2 px-4 py-2.5"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="truncate">{u.email}</span>
                {u.role === "admin" && <Badge variant="muted">админ</Badge>}
                {u.id === selfId && (
                  <span className="text-xs text-muted-foreground">(вы)</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {u.lastSignInAt
                  ? `последний вход: ${new Date(u.lastSignInAt).toLocaleString("ru-RU")}`
                  : "еще не входил"}
              </p>
            </div>
            {u.id !== selfId && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    Удалить
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Удалить пользователя {u.email}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Пользователь будет удален вместе со всеми его данными.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel variant="secondary">
                      Отмена
                    </AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => void handleDelete(u)}
                    >
                      Да, удалить
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
