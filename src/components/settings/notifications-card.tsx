"use client";

import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { DcCard, SectionHead, Verdict } from "@/components/dc/card";
import { StatusChip } from "@/components/dc/chip";
import { Chip } from "@/components/dc/chip";
import type { NotificationStatusDto } from "@/lib/api/types";
import { formatRelativeTime, NBSP } from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { SettingRow } from "./setting-row";

/**
 * Карточка «Уведомления»: канал доставки предупреждений о health factor.
 *
 * Primary-кнопки здесь нет намеренно — единственная на странице занята
 * «Сохранить» в карточке аккаунта (дизайн-код §8). Подключение и проверка
 * идут вторичными кнопками, отключение — danger через AlertDialog.
 *
 * Кнопка «Проверить» существует ради нетерпения: привязку разбирает крон
 * раз в пятнадцать минут, и без неё пользователь смотрел бы на «не
 * подключён» после того, как уже написал боту.
 *
 * Когда на сервере нет токена бота (botConfigured), карточка не предлагает
 * подключение вовсе: выданный в таком окружении код разобрать нечем, и
 * тупик обнаружился бы только после отправки сообщения боту.
 */

const ENDPOINT = "/api/notifications/telegram";

function LinkInstructions({
  code,
  botUsername,
}: {
  code: string;
  botUsername: string | null;
}) {
  const link =
    botUsername === null ? null : `https://t.me/${botUsername}?start=${code}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-chip bg-sunken px-2 py-1 font-mono text-[13.5px] tracking-wide">
          {code}
        </code>
        {link !== null && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="text-[13.5px] text-accent underline-offset-2 hover:underline"
          >
            открыть бота
          </a>
        )}
      </div>
      <p className="t-meta text-text-3">
        {link === null
          ? "Отправьте боту команду «/start " + code + "»."
          : "Откройте бота и нажмите «Запустить» — или отправьте ему «/start " +
            code +
            "»."}{" "}
        Код действует 15{NBSP}минут.
      </p>
    </div>
  );
}

export function NotificationsCard() {
  const { data, loading, refetch } = useApi<NotificationStatusDto>(ENDPOINT);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const channel = data?.channel ?? null;
  const verified = channel?.verified ?? false;
  // До ответа сервера считаем бота настроенным: мигать предупреждением
  // о поломке на каждом заходе в настройки — хуже, чем показать его
  // на полсекунды позже
  const botConfigured = data?.botConfigured ?? true;

  async function act(
    action: "link" | "poll" | "test",
    messages: { success: string; failure: string },
  ) {
    setPending(action);
    setError(null);
    try {
      const result = await apiFetch<NotificationStatusDto & { linked?: number }>(
        ENDPOINT,
        { method: "POST", body: JSON.stringify({ action }) },
      );
      // «Проверить» без новых сообщений — не успех и не ошибка: бот просто
      // ещё не получил команду, и об этом честнее сказать прямо
      if (action === "poll" && !result.channel?.verified) {
        toast.info("Сообщение от бота пока не пришло");
      } else {
        toast.success(messages.success);
      }
      await refetch();
    } catch (err) {
      const text = err instanceof ApiError ? err.message : messages.failure;
      setError(text);
    } finally {
      setPending(null);
    }
  }

  async function toggle(enabled: boolean) {
    setPending("toggle");
    setError(null);
    try {
      await apiFetch<NotificationStatusDto>(ENDPOINT, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      await refetch();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Не удалось изменить канал",
      );
    } finally {
      setPending(null);
    }
  }

  async function disconnect() {
    setPending("delete");
    setError(null);
    try {
      await apiFetch<NotificationStatusDto>(ENDPOINT, { method: "DELETE" });
      toast.success("Канал отключён");
      await refetch();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Не удалось отключить канал",
      );
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null || (loading && !data);
  const sentAgo = formatRelativeTime(channel?.lastSentAt ?? null);
  // Без бота и без привязки в ряду не остаётся ни одной кнопки —
  // пустая полоса с рамкой выглядела бы как недогрузившийся интерфейс
  const showActions = botConfigured || verified || error !== null;

  return (
    <DcCard as="section">
      <SectionHead
        title="Уведомления"
        hint="Крон проверяет health factor каждые 15 минут и пишет, когда тот уходит ниже порога, резко падает или восстанавливается."
        note="Предупреждения о риске ликвидации приходят в телеграм."
      />

      <div className="divide-y divide-line border-line border-t">
        <SettingRow
          label="Телеграм"
          hint="Один бот на приложение; сообщения приходят в личный чат с ним."
        >
          {channel === null ? (
            botConfigured ? (
              <Chip>не подключён</Chip>
            ) : (
              <StatusChip tone="warn">не настроен</StatusChip>
            )
          ) : verified ? (
            <StatusChip tone={channel.enabled ? "profit" : "warn"}>
              {channel.enabled ? "подключён" : "выключен"}
            </StatusChip>
          ) : (
            <StatusChip tone="warn">ждёт подтверждения</StatusChip>
          )}
          {channel?.chatTitle !== null && channel?.chatTitle !== undefined && (
            <span className="t-meta text-text-3">{channel.chatTitle}</span>
          )}
          {sentAgo !== null && (
            <span className="t-meta text-text-3">
              последнее сообщение{NBSP}—{NBSP}
              {sentAgo}
            </span>
          )}
        </SettingRow>

        {botConfigured && data?.linkCode != null && (
          <SettingRow label="Код привязки">
            <LinkInstructions
              code={data.linkCode}
              botUsername={data.botUsername}
            />
          </SettingRow>
        )}

        {verified && (
          <SettingRow
            htmlFor="notifications-enabled"
            label="Присылать предупреждения"
            hint="Выключение сохраняет привязку: сообщения перестают приходить, подключать бота заново не нужно."
          >
            <Switch
              id="notifications-enabled"
              checked={channel?.enabled ?? false}
              onCheckedChange={toggle}
              disabled={busy}
            />
          </SettingRow>
        )}
      </div>

      {showActions && (
        <div className="flex flex-wrap items-center gap-2.5 border-line border-t px-card py-3.5">
          {botConfigured && (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                act("link", {
                  success: "Код получен",
                  failure: "Не удалось получить код",
                })
              }
              disabled={busy}
            >
              {channel === null ? "Подключить" : "Новый код"}
            </Button>
          )}

          {botConfigured && data?.linkCode != null && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                act("poll", {
                  success: "Канал подключён",
                  failure: "Не удалось проверить",
                })
              }
              disabled={busy}
            >
              {pending === "poll" ? "Проверка…" : "Проверить"}
            </Button>
          )}

          {verified && (
            <>
              {botConfigured && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    act("test", {
                      success: "Сообщение отправлено",
                      failure: "Не удалось отправить",
                    })
                  }
                  disabled={busy}
                >
                  Отправить тестовое
                </Button>
              )}

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" disabled={busy}>
                    Отключить
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Отключить уведомления?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Предупреждения о health factor перестанут приходить.
                      Привязку бота придётся сделать заново.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={disconnect}
                      className="bg-loss text-white hover:bg-loss/90"
                    >
                      Отключить
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}

          {error !== null && (
            <p role="alert" className="t-meta text-loss">
              {error}
            </p>
          )}
        </div>
      )}

      {!botConfigured ? (
        <Verdict>
          Бот не настроен на сервере: переменные TELEGRAM_BOT_TOKEN и
          TELEGRAM_BOT_USERNAME не заданы в этом окружении. Подключение
          появится, когда их добавят и передеплоят приложение.
        </Verdict>
      ) : (
        channel?.lastError != null &&
        error === null && (
          <Verdict>Последняя отправка не прошла: {channel.lastError}</Verdict>
        )
      )}
    </DcCard>
  );
}
