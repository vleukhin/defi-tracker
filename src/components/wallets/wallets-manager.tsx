"use client";

import { useState } from "react";
import { isAddress } from "viem";
import type { WalletDto } from "@/lib/api/types";
import { formatRelativeTime, truncateAddress } from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";

/**
 * Управление кошельками (S1.2): список read-only адресов, добавление
 * с клиентской предпроверкой EIP-55 (viem isAddress: lowercase принимается,
 * неверный checksum — нет), удаление с подтверждением.
 * Никаких полей для приватных ключей и сид-фраз — только публичный адрес.
 */

function CopyButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Клипборд недоступен (напр., без HTTPS) — молча пропускаем
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Скопировать адрес ${address}`}
      className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
    >
      {copied ? "Скопировано" : "Копировать"}
    </button>
  );
}

function WalletRow({
  wallet,
  onDeleted,
}: {
  wallet: WalletDto;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`/api/wallets/${wallet.id}`, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось удалить");
      setDeleting(false);
    }
  }

  const refreshedAgo = formatRelativeTime(wallet.lastRefreshedAt);

  return (
    <li className="border-t border-gray-100 px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">
            {wallet.label ?? "Без метки"}
          </p>
          <p className="flex items-center gap-1 text-xs text-gray-500">
            <span className="font-mono" title={wallet.address}>
              {truncateAddress(wallet.address)}
            </span>
            <CopyButton address={wallet.address} />
          </p>
          <p className="text-xs text-gray-400">
            {refreshedAgo ? `обновлен ${refreshedAgo}` : "еще не обновлялся"}
          </p>
        </div>
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Удалить
          </button>
        )}
      </div>

      {confirming && (
        <div
          role="alertdialog"
          aria-label="Подтверждение удаления кошелька"
          className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5"
        >
          <p className="text-sm text-red-800">
            Балансы этого кошелька будут убраны из портфеля.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? "Удаление…" : "Удалить"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Отмена
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function WalletsManager() {
  const { data, error, loading, refetch } = useApi<{ wallets: WalletDto[] }>(
    "/api/wallets",
  );
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    // Предпроверка EIP-55 до похода на сервер (S1.2)
    if (!isAddress(address.trim(), { strict: true })) {
      setFormError("Некорректный адрес");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/api/wallets", {
        method: "POST",
        body: JSON.stringify({
          address: address.trim(),
          ...(label.trim() ? { label: label.trim() } : {}),
        }),
      });
      setAddress("");
      setLabel("");
      await refetch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setFormError("Некорректный адрес");
      } else if (err instanceof ApiError && err.status === 409) {
        setFormError("Кошелек уже добавлен");
      } else {
        setFormError(
          err instanceof ApiError ? err.message : "Не удалось добавить кошелек",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Форма добавления */}
      <form
        onSubmit={handleAdd}
        className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <h2 className="text-sm font-medium text-gray-700">Добавить адрес</h2>
        <div className="space-y-1">
          <label htmlFor="wallet-address" className="block text-sm font-medium">
            EVM-адрес
          </label>
          <input
            id="wallet-address"
            type="text"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="wallet-label" className="block text-sm font-medium">
            Метка <span className="font-normal text-gray-400">(необязательно)</span>
          </label>
          <input
            id="wallet-label"
            type="text"
            maxLength={64}
            placeholder="Основной, Ledger…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
          />
        </div>
        {formError && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {formError}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {submitting ? "Добавление…" : "Добавить"}
        </button>
        <p className="text-xs text-gray-500">
          Адрес отслеживается на Ethereum, Arbitrum, Base и Optimism.
        </p>
      </form>

      {/* Список */}
      {loading && !data ? (
        <div aria-busy="true" className="h-24 animate-pulse rounded-lg bg-gray-100" />
      ) : error && !data ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>Не удалось загрузить кошельки: {error}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium hover:bg-red-100"
          >
            Повторить
          </button>
        </div>
      ) : data && data.wallets.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
          Кошельков пока нет — добавьте первый адрес выше.
        </p>
      ) : data ? (
        <ul className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          {data.wallets.map((w) => (
            <WalletRow key={w.id} wallet={w} onDeleted={() => void refetch()} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
