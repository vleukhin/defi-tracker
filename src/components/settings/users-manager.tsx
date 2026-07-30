"use client";

import { useCallback, useEffect, useState } from "react";
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
 */
export function UsersManager({ selfId }: { selfId: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);

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
    setNotice(null);
    try {
      await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setNotice({ kind: "ok", text: `Пользователь ${email} создан` });
      setEmail("");
      setPassword("");
      load();
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof ApiError ? err.message : "Не удалось создать",
      });
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(user: AdminUser) {
    setConfirmDelete(null);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      setNotice({ kind: "ok", text: `Пользователь ${user.email} удален` });
      load();
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof ApiError ? err.message : "Не удалось удалить",
      });
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-medium text-gray-700">Пользователи</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Публичной регистрации нет — аккаунты создает администратор. Email
          нового пользователя считается подтвержденным сразу.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-2 px-4 py-3 sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          aria-label="Email нового пользователя"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль (мин. 8 символов)"
          aria-label="Пароль нового пользователя"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {pending ? "Создание…" : "Создать"}
        </button>
      </form>

      {notice && (
        <p
          className={`px-4 pb-2 text-sm ${notice.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      <ul className="divide-y divide-gray-100 border-t border-gray-100">
        {users === null && (
          <li className="px-4 py-3 text-sm text-gray-400">Загрузка…</li>
        )}
        {users?.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm text-gray-900">
                {u.email}
                {u.role === "admin" && (
                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                    админ
                  </span>
                )}
                {u.id === selfId && (
                  <span className="ml-2 text-xs text-gray-400">(вы)</span>
                )}
              </p>
              <p className="text-xs text-gray-400">
                {u.lastSignInAt
                  ? `последний вход: ${new Date(u.lastSignInAt).toLocaleString("ru-RU")}`
                  : "еще не входил"}
              </p>
            </div>
            {u.id !== selfId &&
              (confirmDelete?.id === u.id ? (
                <div
                  role="alertdialog"
                  aria-label={`Удалить пользователя ${u.email}?`}
                  className="flex items-center gap-2"
                >
                  <span className="text-xs text-red-700">
                    Удалить вместе со всеми данными?
                  </span>
                  <button
                    onClick={() => handleDelete(u)}
                    className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    Да, удалить
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    Отмена
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(u)}
                  className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                >
                  Удалить
                </button>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
