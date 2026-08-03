"use client";

import { Check, Copy, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Chip } from "@/components/dc/chip";
import { DcCard, EmptyState, SectionHead, Verdict } from "@/components/dc/card";
import { HelpTip } from "@/components/dc/help-tip";
import {
  FreshnessDot,
  MetaDot,
  PageHeader,
  ProtocolTile,
} from "@/components/dc/page-header";
import { Dash, DcTable, Td, Th, Tr } from "@/components/dc/table";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import type {
  LeverageResponseDto,
  PortfolioDto,
  WalletDto,
} from "@/lib/api/types";
import { dcUsd, formatRelativeTime, truncateAddress } from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import {
  EMPTY_FACTS,
  plural,
  walletFacts,
  walletTag,
  type WalletFacts,
} from "./wallet-facts";

/**
 * Экран «Кошельки» (README §7): список read-only адресов и то, что
 * приложение по ним читает. Добавление — с клиентской предпроверкой EIP-55
 * (viem isAddress: lowercase принимается, неверный checksum — нет),
 * удаление — через AlertDialog. Полей для приватных ключей и сид-фраз нет
 * и быть не может: приложение работает только на чтение.
 *
 * Сеть, стоимость и состав протоколов в API кошельков не приходят —
 * собираются из /api/portfolio и /api/leverage (см. wallet-facts.ts).
 */

/** Данные считаются устаревшими через 15 минут — точка уходит в warn. */
const STALE_MS = 15 * 60 * 1000;

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
      className="text-text-4 hover:text-text-1"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </Button>
  );
}

function WalletRow({
  wallet,
  facts,
  now,
  onDeleted,
}: {
  wallet: WalletDto;
  facts: WalletFacts;
  /** Момент отсчёта возраста данных — тикает раз в минуту в родителе. */
  now: number;
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

  const refreshedAgo = formatRelativeTime(wallet.lastRefreshedAt, now);
  const refreshedMs = wallet.lastRefreshedAt
    ? Date.parse(wallet.lastRefreshedAt)
    : null;
  const stale =
    refreshedMs === null ||
    Number.isNaN(refreshedMs) ||
    now - refreshedMs > STALE_MS;

  return (
    <Tr>
      <Td>
        <div className="flex items-center gap-[11px]">
          <ProtocolTile abbr={walletTag(wallet)} color="var(--text-2)" size={28} />
          <div className="min-w-0">
            <div className="font-medium text-[13.5px]">
              {wallet.label ?? "Без метки"}
            </div>
            <div className="flex items-center gap-1">
              <span className="font-mono text-[12px] text-text-3" title={wallet.address}>
                {truncateAddress(wallet.address)}
              </span>
              <CopyButton address={wallet.address} />
            </div>
          </div>
        </div>
        {error && (
          <p role="alert" className="t-meta mt-1.5 text-loss">
            {error}
          </p>
        )}
      </Td>

      <Td className="text-text-2">
        {facts.chains.length > 0 ? facts.chains.join(", ") : <Dash />}
      </Td>

      <Td numeric mono>
        {facts.valueUsd === null ? <Dash /> : dcUsd(facts.valueUsd)}
      </Td>

      <Td className="text-[12.5px] text-text-2">
        {facts.reads.length > 0 ? facts.reads.join(", ") : <Dash />}
      </Td>

      <Td numeric className="text-[12.5px] text-text-3">
        <span className="inline-flex items-center gap-[7px]">
          <FreshnessDot stale={stale} />
          {refreshedAgo ?? "не читался"}
        </span>
      </Td>

      <Td numeric>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" size="sm" disabled={deleting}>
              {deleting ? "Удаление…" : "Удалить"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить кошелёк?</AlertDialogTitle>
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
      </Td>
    </Tr>
  );
}

/** Скелетон строки: размеры конечных элементов, цвет --bg-chip. */
function SkeletonRow() {
  return (
    <Tr className="hover:bg-transparent">
      <Td>
        <div className="flex items-center gap-[11px]">
          <div className="size-[28px] shrink-0 rounded-[10px] bg-chip" />
          <div className="space-y-1.5">
            <div className="h-3 w-24 rounded-pill bg-chip" />
            <div className="h-2.5 w-28 rounded-pill bg-chip" />
          </div>
        </div>
      </Td>
      <Td>
        <div className="h-3 w-16 rounded-pill bg-chip" />
      </Td>
      <Td numeric>
        <div className="ml-auto h-3 w-20 rounded-pill bg-chip" />
      </Td>
      <Td>
        <div className="h-3 w-24 rounded-pill bg-chip" />
      </Td>
      <Td numeric>
        <div className="ml-auto h-3 w-14 rounded-pill bg-chip" />
      </Td>
      <Td />
    </Tr>
  );
}

export function WalletsManager() {
  const { data, error, loading, refetch } = useApi<{ wallets: WalletDto[] }>(
    "/api/wallets",
  );
  // Обогащение таблицы: чей это залог и какие позиции читаются по адресу.
  // Оба ответа — кэш без RPC, поэтому экран не ждёт цепочек.
  const { data: portfolio } = useApi<PortfolioDto>("/api/portfolio");
  const { data: leverage } = useApi<LeverageResponseDto>("/api/leverage");

  // Возраст данных пересчитывается раз в минуту, а не на каждый рендер:
  // «4 мин назад» обязано стареть само, без перезагрузки страницы
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [formOpen, setFormOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const wallets = data?.wallets ?? null;

  function closeForm() {
    setFormOpen(false);
    setFormError(null);
    setAddress("");
    setLabel("");
  }

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
      await refetch();
      closeForm();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setFormError("Некорректный адрес");
      } else if (err instanceof ApiError && err.status === 409) {
        setFormError("Кошелёк уже добавлен");
      } else {
        setFormError(
          err instanceof ApiError ? err.message : "Не удалось добавить кошелёк",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Разбор ответов портфеля и позиций — один раз на рендер, а не на строку
  const factsById = useMemo(
    () =>
      new Map(
        (wallets ?? []).map(
          (w) => [w.id, walletFacts(w.id, portfolio, leverage)] as const,
        ),
      ),
    [wallets, portfolio, leverage],
  );

  // Мета-строка заголовка: сети считаются по тому, где реально что-то
  // прочитано, а не по списку поддерживаемых сетей
  const chainCount = new Set(
    [...factsById.values()].flatMap((f) => f.chains),
  ).size;
  const unpricedSomewhere = [...factsById.values()].some((f) => f.unpriced);

  return (
    <>
      <PageHeader
        title="Кошельки"
        meta={
          wallets && (
            <>
              <span>{plural(wallets.length, "адрес", "адреса", "адресов")}</span>
              <MetaDot />
              <span>{plural(chainCount, "сеть", "сети", "сетей")}</span>
              <MetaDot />
              <span>обновление не чаще раза в минуту</span>
            </>
          )
        }
        action={
          <Button
            type="button"
            onClick={() => (formOpen ? closeForm() : setFormOpen(true))}
            aria-expanded={formOpen}
          >
            Добавить адрес
          </Button>
        }
      />

      <ReadOnlyNotice className="-mt-2" />

      {formOpen && (
        <DcCard className="animate-in fade-in-0 duration-160 ease-out">
          <SectionHead
            title="Новый адрес"
            action={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={closeForm}
                aria-label="Закрыть форму"
              >
                <X />
              </Button>
            }
          />
          <form onSubmit={handleAdd} className="border-line border-t bg-sunken px-card py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label
                  htmlFor="wallet-address"
                  className="text-[12.5px] font-normal text-text-2"
                >
                  EVM-адрес
                </Label>
                <Input
                  id="wallet-address"
                  type="text"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="0x…"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="bg-surface font-mono placeholder:font-mono"
                />
              </div>
              <div className="space-y-1.5 sm:w-56">
                <Label
                  htmlFor="wallet-label"
                  className="text-[12.5px] font-normal text-text-2"
                >
                  Метка <span className="text-text-3">(необязательно)</span>
                </Label>
                <Input
                  id="wallet-label"
                  type="text"
                  maxLength={64}
                  placeholder="Основной, Ledger…"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="bg-surface"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="secondary" disabled={submitting}>
                  {submitting ? "Добавление…" : "Добавить"}
                </Button>
                <Button type="button" variant="outline" onClick={closeForm}>
                  Отмена
                </Button>
              </div>
            </div>
            {formError && (
              <p role="alert" className="t-meta mt-2.5 text-loss">
                {formError}
              </p>
            )}
          </form>
          <Verdict>
            Адрес отслеживается на Ethereum, Arbitrum, Base и Optimism —
            выбирать сеть не нужно.
          </Verdict>
        </DcCard>
      )}

      <DcCard>
        {error && !wallets ? (
          <div className="flex flex-col items-center gap-3 px-card py-10 text-center">
            <p className="t-body text-text-2">Не удалось загрузить кошельки: {error}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void refetch()}
            >
              Повторить
            </Button>
          </div>
        ) : wallets && wallets.length === 0 ? (
          <EmptyState
            title="Адресов пока нет"
            action={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setFormOpen(true)}
              >
                Добавить адрес
              </Button>
            }
          />
        ) : (
          <>
            <DcTable minWidth={880}>
              <thead>
                <tr>
                  <Th>Адрес</Th>
                  <Th>Сеть</Th>
                  <Th numeric>Стоимость</Th>
                  <Th>
                    <span className="inline-flex items-center gap-1.5">
                      Что читаем
                      <HelpTip>
                        Протоколы, в которых у адреса что-то нашлось: залог
                        Aave и позиции Fluid, GMX и Uniswap. Балансы токенов
                        читаются по адресу всегда.
                      </HelpTip>
                    </span>
                  </Th>
                  <Th numeric>Синхрон</Th>
                  <Th numeric>
                    <span className="sr-only">Действия</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {loading && !wallets
                  ? [0, 1, 2].map((i) => <SkeletonRow key={i} />)
                  : wallets?.map((w) => (
                      <WalletRow
                        key={w.id}
                        wallet={w}
                        facts={factsById.get(w.id) ?? EMPTY_FACTS}
                        now={now}
                        onDeleted={() => void refetch()}
                      />
                    ))}
              </tbody>
            </DcTable>
            <Verdict
              chip={
                unpricedSomewhere ? <Chip>часть позиций без оценки</Chip> : undefined
              }
            >
              Монеты вне лендинга — биржа и холодный кошелёк — вносятся вручную
              на странице «Цели».
            </Verdict>
          </>
        )}
      </DcCard>
    </>
  );
}
