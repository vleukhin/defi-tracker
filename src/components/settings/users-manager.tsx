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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DcCard, SectionHead } from "@/components/dc/card";
import { Chip } from "@/components/dc/chip";
import { ProtocolTile } from "@/components/dc/page-header";
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
 * README §9: строка создания на фоне sunken, ниже список — аватар-инициалы,
 * email Mono, чипы роли, справа danger-действие. Успех — тостом, ошибка —
 * инлайн; удаление — AlertDialog.
 */

/** «30.07.2026, 22:44» — дата с временем: последний вход без времени бесполезен. */
function formatSignIn(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  return new Date(ts).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Инициалы для аватара: две буквы из локальной части email. */
function initials(email: string | undefined): string {
  const local = email?.split("@")[0] ?? "";
  const parts = local.split(/[.\-_]+/).filter(Boolean);
  const first = parts[0] ?? "";
  const second = parts[1];
  const abbr = second ? `${first[0]}${second[0]}` : first.slice(0, 2);
  return abbr ? abbr.toUpperCase() : "—";
}

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
      toast.success(`Пользователь ${user.email} удалён`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить");
    }
  }

  return (
    <DcCard as="section">
      <SectionHead
        title="Пользователи"
        count="публичной регистрации нет — аккаунты создаёт администратор"
      />

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-2.5 border-line border-y bg-sunken px-card py-3.5 sm:flex-row sm:items-center"
      >
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          aria-label="Email нового пользователя"
          className="flex-1 bg-surface"
        />
        <Input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль, минимум 8 символов"
          aria-label="Пароль нового пользователя"
          className="flex-1 bg-surface"
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Создание…" : "Создать"}
        </Button>
      </form>

      {error && (
        <p role="alert" className="t-meta border-line border-b px-card py-2.5 text-loss">
          {error}
        </p>
      )}

      <ul className="divide-y divide-line">
        {users === null && (
          <li className="flex items-center gap-3 px-card py-3.5">
            <div className="size-[30px] shrink-0 rounded-[10px] bg-chip" />
            <div className="space-y-1.5">
              <div className="h-3 w-40 rounded-pill bg-chip" />
              <div className="h-2.5 w-32 rounded-pill bg-chip" />
            </div>
          </li>
        )}
        {users?.map((u) => (
          <li key={u.id} className="flex items-center gap-3 px-card py-3.5">
            <ProtocolTile abbr={initials(u.email)} color="var(--text-2)" size={30} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-mono text-[13px]">{u.email}</span>
                {u.role === "admin" && <Chip>админ</Chip>}
                {u.id === selfId && (
                  <span className="text-[11.5px] text-text-3">это вы</span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-text-3">
                {u.lastSignInAt
                  ? `последний вход ${formatSignIn(u.lastSignInAt)}`
                  : "ещё не входил"}
              </p>
            </div>
            {u.id !== selfId && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="shrink-0"
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
                      Пользователь будет удалён вместе со всеми его данными.
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
    </DcCard>
  );
}
