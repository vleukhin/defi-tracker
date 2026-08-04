import "server-only";
import { z } from "zod";

/**
 * Действия над каналом уведомлений (Фаза 6).
 *
 * Один POST с полем `action` вместо четырёх роутов: все действия работают
 * с одной и той же строкой канала, и разносить их по путям значило бы
 * четыре раза повторить поиск этой строки и проверку владения.
 *
 *  * link  — завести канал и выдать одноразовый код привязки;
 *  * poll  — вручную забрать сообщения бота, чтобы не ждать крона;
 *  * test  — отправить тестовое сообщение в уже привязанный канал.
 *
 * Включение/выключение — PATCH, отключение — DELETE: это состояние
 * ресурса, а не действие над ним.
 */

/** Виды каналов, доступные интерфейсу. Совпадает с check в БД. */
export const channelKindSchema = z.enum(["telegram"]);

export const notificationActionSchema = z.object({
  action: z.enum(["link", "poll", "test"], {
    message: "Неизвестное действие",
  }),
});

export const notificationPatchSchema = z.object({
  enabled: z.boolean({ message: "Ожидается true или false" }),
});

export type NotificationAction = z.infer<typeof notificationActionSchema>;
export type NotificationPatch = z.infer<typeof notificationPatchSchema>;
