"use client";

import { Check, CircleAlert, Copy } from "lucide-react";
import { useState } from "react";
import { isAddress } from "viem";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { WalletDto } from "@/lib/api/types";
import { formatRelativeTime, truncateAddress } from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";

/**
 * Управление кошельками (S1.2, дизайн §5.2): список read-only адресов,
 * добавление с клиентской предпроверкой EIP-55 (viem isAddress: lowercase
 * принимается, неверный checksum — нет), удаление через AlertDialog.
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
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={copy}
      aria-label={`Скопировать адрес ${address}`}
      className="text-muted-foreground hover:text-foreground"
    >
      {copied ? (
        <Check className="size-4 text-success" />
      ) : (
        <Copy className="size-4" />
      )}
    </Button>
  );
}

function WalletRow({
  wallet,
  onDeleted,
}: {
  wallet: WalletDto;
  onDeleted: () => void;
}) {
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
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{wallet.label ?? "Без метки"}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="font-mono" title={wallet.address}>
              {truncateAddress(wallet.address)}
            </span>
            <CopyButton address={wallet.address} />
          </p>
          <p className="text-xs text-muted-foreground">
            {refreshedAgo ? `обновлен ${refreshedAgo}` : "еще не обновлялся"}
          </p>
        </div>

        {/* Подтверждение удаления — AlertDialog (ТЗ §5.2) */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={deleting}
              className="text-muted-foreground hover:text-destructive"
            >
              {deleting ? "Удаление…" : "Удалить"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить кошелек?</AlertDialogTitle>
              <AlertDialogDescription>
                Балансы этого кошелька будут убраны из портфеля.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel variant="secondary">Отмена</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void handleDelete()}
              >
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
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
      <Card className="p-4">
        <form onSubmit={handleAdd} className="space-y-3">
          <h2 className="text-sm font-semibold">Добавить адрес</h2>
          <div className="space-y-1.5">
            <Label htmlFor="wallet-address">EVM-адрес</Label>
            <Input
              id="wallet-address"
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="font-mono placeholder:font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wallet-label">
              Метка{" "}
              <span className="font-normal text-muted-foreground">
                (необязательно)
              </span>
            </Label>
            <Input
              id="wallet-label"
              type="text"
              maxLength={64}
              placeholder="Основной, Ledger…"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Добавление…" : "Добавить"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Адрес отслеживается на Ethereum, Arbitrum, Base и Optimism.
          </p>
        </form>
      </Card>

      {/* Список */}
      {loading && !data ? (
        <Skeleton aria-busy="true" className="h-24 rounded-xl" />
      ) : error && !data ? (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>Не удалось загрузить кошельки: {error}</AlertTitle>
          <AlertDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              className="mt-2"
            >
              Повторить
            </Button>
          </AlertDescription>
        </Alert>
      ) : data && data.wallets.length === 0 ? (
        <Card className="p-0">
          <p className="py-6 text-center text-sm text-muted-foreground">
            Кошельков пока нет — добавьте первый адрес выше.
          </p>
        </Card>
      ) : data ? (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {data.wallets.map((w) => (
              <WalletRow key={w.id} wallet={w} onDeleted={() => void refetch()} />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
