import type { ApiProvider } from "@/lib/metrics";

/**
 * Контракт канала доставки уведомлений.
 *
 * Каналов сейчас один — телеграм, но интерфейс существует не ради будущего
 * «а вдруг»: он задаёт границу, за которую не проходит знание о конкретном
 * мессенджере. Отправитель (крон) собирает событие, канал — разметку и
 * транспорт. Иначе первое же добавление почты потребовало бы править
 * правила уведомлений.
 *
 * Модуль намеренно без "server-only": типы нужны и клиентскому коду
 * настроек (ChannelKind в DTO), а реализации каналов server-only сами.
 */

/** Виды каналов. Новый вид = новый литерал здесь, в реестре и в check БД. */
export type ChannelKind = "telegram";

/**
 * Сообщение в виде структуры, а не готовой строки: разметка у каналов
 * разная (телеграм — простой текст, почта — тема и тело), и собирать её
 * должен канал, а не отправитель.
 */
export interface OutgoingMessage {
  /** Первая строка — что случилось. */
  title: string;
  /** Подробности, по одной мысли на строку. */
  lines: string[];
}

export interface DeliveryResult {
  ok: boolean;
  error?: string;
  /**
   * Адресат недоступен НАВСЕГДА (бот заблокирован, чат удалён) — канал
   * гасится, чтобы не долбиться в него каждые пятнадцать минут. Обычная
   * сетевая ошибка сюда не относится: она пройдёт сама.
   */
  disable?: boolean;
}

export interface ChannelSendOptions {
  /** Инъекция для тестов — как fetchFn в prices/coingecko. */
  fetchFn?: typeof fetch;
  /**
   * Сигнатура повторяет logApiCall один в один: иначе `opts.logCall ??
   * logApiCall` сводит два несовпадающих типа к never.
   */
  logCall?: (
    provider: ApiProvider,
    endpoint: string,
    opts?: { units?: number; ok?: boolean },
  ) => Promise<void>;
}

export interface NotificationChannel {
  kind: ChannelKind;
  /**
   * config — строка notification_channels.config: адресация, о смысле
   * которой знает только сам канал.
   */
  send(
    config: unknown,
    message: OutgoingMessage,
    opts?: ChannelSendOptions,
  ): Promise<DeliveryResult>;
}
