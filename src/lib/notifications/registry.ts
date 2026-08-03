import { telegramChannel } from "./telegram";
import type { ChannelKind, NotificationChannel } from "./types";

/**
 * Реестр каналов: единственное место, где отправитель узнаёт про телеграм.
 * Добавление канала — запись здесь, реализация интерфейса и новый литерал
 * в check-констрейнте notification_channels.kind.
 */
const CHANNELS: Record<ChannelKind, NotificationChannel> = {
  telegram: telegramChannel,
};

export function getChannel(kind: ChannelKind): NotificationChannel {
  return CHANNELS[kind];
}

/** Строка из БД пришла с неизвестным видом канала — реестр отстал от схемы. */
export function isKnownChannelKind(kind: string): kind is ChannelKind {
  return kind in CHANNELS;
}
