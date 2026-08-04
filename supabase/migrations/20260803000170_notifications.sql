-- =============================================================================
-- Уведомления о health factor: каналы доставки, состояние правил, журнал.
--
-- Зачем. Ликвидация — единственный сценарий, способный принудительно прервать
-- накопление, но до сих пор HF был виден только тому, кто сам открыл экран:
-- aave_account_health обновляется кнопкой «Обновить» и ночным кроном
-- снепшотов. Между 03:00 UTC и следующим заходом на сайт падение HF не видит
-- никто — а именно в этом промежутке стратегия требует действовать
-- (docs/07 §7: «HF < 1,3 при резком падении — поднять HF к ≈1,5»).
--
-- Почему каналы отдельной таблицей, а не колонками в user_settings. Настройка
-- отвечает на вопрос «как считать», канал — «куда слать»; у одного
-- пользователя каналов может стать несколько, и у каждого своя судьба
-- (подтверждён, выключен, заблокирован адресатом). Расширяемость держится
-- на паре kind + config jsonb: новый канал — это новый литерал в check
-- и новая реализация в коде, а не миграция схемы.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- notification_channels: адрес доставки. config хранит адресацию, специфичную
-- для канала (у телеграма — {"chatId": 123}); общие для всех каналов свойства
-- вынесены в колонки, чтобы по ним можно было фильтровать и строить индексы.
--
-- verified_at NULL = канал заведён, но адресат ещё не подтвердил владение
-- (код привязки не отработал). Слать в неподтверждённый канал нельзя: пока
-- chat_id не пришёл от самого телеграма, мы не знаем, чей это чат.
-- -----------------------------------------------------------------------------
create table public.notification_channels (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  kind                 text not null check (kind in ('telegram')),
  config               jsonb not null default '{}'::jsonb,
  enabled              boolean not null default true,
  verified_at          timestamptz,
  -- Одноразовый код привязки и его срок. Живёт в самой строке канала:
  -- отдельная таблица кодов хранила бы ровно те же ключи и требовала бы
  -- собственной уборки просроченного.
  link_code            text,
  link_code_expires_at timestamptz,
  -- Последняя ошибка доставки. Показывается в настройках: канал, который
  -- молча не работает, хуже отсутствующего.
  last_error           text,
  last_sent_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Один канал каждого вида на пользователя: два телеграма — это два адресата
-- одного и того же сообщения, а не настройка.
create unique index notification_channels_user_kind_idx
  on public.notification_channels (user_id, kind);

-- Код привязки ищется по себе самому (пользователь присылает его боту),
-- поэтому он обязан быть уникальным среди действующих.
create unique index notification_channels_link_code_idx
  on public.notification_channels (link_code)
  where link_code is not null;

-- Один чат не может обслуживать двух пользователей: иначе перехваченный код
-- увёл бы чужие уведомления в уже привязанный чат.
create unique index notification_channels_chat_idx
  on public.notification_channels (kind, (config ->> 'chatId'))
  where config ? 'chatId';

alter table public.notification_channels enable row level security;

create policy "notification_channels: owner full access"
  on public.notification_channels
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- hf_alert_state: состояние правил уведомления по (кошелёк, сеть) — на том же
-- уровне, что и aave_account_health, потому что ликвидация приходит к
-- конкретному кошельку в конкретной сети, а не к портфелю целиком.
--
-- КЛЮЧЕВОЕ: здесь лежит зона и HF ПОСЛЕДНЕГО ОТПРАВЛЕННОГО сообщения, а не
-- последнего наблюдения. Наблюдение, не породившее события, состояние не
-- трогает — иначе правило «упал на 10%» мерило бы шаг между соседними
-- прогонами и медленное сползание не заметило бы никогда.
--
-- zone = 'stale' — особое состояние «HF не читается»: оно тоже уведомляется
-- один раз, и выход из него тоже событие. Молчание неотличимо от «всё
-- хорошо», поэтому слепота обязана быть состоянием, а не пробелом в данных.
-- -----------------------------------------------------------------------------
create table public.hf_alert_state (
  wallet_id   uuid not null references public.wallets (id) on delete cascade,
  chain       text not null check (chain in ('ethereum', 'arbitrum', 'base', 'optimism')),
  zone        text not null check (
    zone in ('none', 'calm', 'close', 'below', 'urgent', 'critical', 'stale')
  ),
  -- HF, при котором ушло последнее сообщение. NULL = долга тогда не было («∞»).
  notified_hf numeric check (notified_hf is null or notified_hf >= 0),
  notified_at timestamptz not null default now(),
  primary key (wallet_id, chain)
);

alter table public.hf_alert_state enable row level security;

-- Чтение — владелец кошелька (тот же паттерн, что у aave_account_health);
-- запись только service_role: состояние ведёт крон, и правка его руками
-- означала бы подделку истории уведомлений.
create policy "hf_alert_state: owner read via wallet"
  on public.hf_alert_state
  for select
  to authenticated
  using (
    exists (
      select 1 from public.wallets w
      where w.id = hf_alert_state.wallet_id
        and w.user_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- notification_log: что и кому ушло. Закрытая таблица по образцу api_call_log —
-- нужна для разбора «почему не пришло» и «почему пришло дважды», в интерфейсе
-- не показывается.
--
-- body хранится целиком: воспроизвести текст задним числом нельзя (он зависит
-- от порога и HF на тот момент), а именно текст и оспаривается, когда
-- уведомление кажется ложным.
-- -----------------------------------------------------------------------------
create table public.notification_log (
  id         bigint generated always as identity primary key,
  -- on delete set null: журнал переживает удаление пользователя и канала,
  -- иначе разбор инцидента исчезает вместе с тем, кого он касался
  user_id    uuid references auth.users (id) on delete set null,
  channel_id uuid references public.notification_channels (id) on delete set null,
  kind       text not null,
  event      text not null,
  body       text not null,
  ok         boolean not null default true,
  error      text,
  sent_at    timestamptz not null default now()
);

create index notification_log_user_sent_at_idx
  on public.notification_log (user_id, sent_at);

alter table public.notification_log enable row level security;

-- -----------------------------------------------------------------------------
-- telegram_bot_state: offset для getUpdates. Без вебхука Bot API отдаёт
-- обновления по возрастающему update_id, и подтверждением обработки служит
-- offset следующего запроса — его надо помнить между прогонами крона.
--
-- Строка ровно одна на бота (токен один на всё приложение), поэтому primary
-- key — константа: check (singleton) не даёт завести вторую.
-- -----------------------------------------------------------------------------
create table public.telegram_bot_state (
  singleton     boolean primary key default true check (singleton),
  update_offset bigint not null default 0 check (update_offset >= 0),
  updated_at    timestamptz not null default now()
);

alter table public.telegram_bot_state enable row level security;

-- -----------------------------------------------------------------------------
-- api_call_log: телеграм — такой же внешний API, как остальные, и его вызовы
-- должны попадать в тот же счётчик (ТЗ Часть 4 §2: счётчики с первого дня).
-- -----------------------------------------------------------------------------
alter table public.api_call_log
  drop constraint api_call_log_provider_check;

alter table public.api_call_log
  add constraint api_call_log_provider_check
  check (provider in ('coingecko', 'alchemy', 'rpc', 'zerion', 'gmx', 'telegram'));

-- =============================================================================
-- GRANT'ы: auto_expose_new_tables = off — без явных GRANT'ов новые таблицы
-- недоступны даже при правильных RLS-политиках.
-- =============================================================================

grant all on
  public.notification_channels,
  public.hf_alert_state,
  public.notification_log,
  public.telegram_bot_state
to service_role;

-- Канал пользователь заводит и выключает сам
grant select, insert, update, delete on public.notification_channels to authenticated;

-- Состояние алертов — только чтение (пишет крон под service_role)
grant select on public.hf_alert_state to authenticated;

-- Журнал отправок и состояние бота — полностью закрыты (как api_call_log):
-- RLS без политик плюс явный revoke.
revoke all on public.notification_log from anon, authenticated;
revoke all on public.telegram_bot_state from anon, authenticated;

-- =============================================================================
-- COMMENT'ы на неочевидное
-- =============================================================================

comment on column public.notification_channels.config is
  'Адресация внутри канала. Телеграм: {"chatId": 123456}. Общие свойства '
  'канала (включён, подтверждён, последняя ошибка) — колонками, чтобы по ним '
  'можно было фильтровать; в jsonb только то, что у каждого канала своё.';

comment on column public.notification_channels.verified_at is
  'Момент подтверждения адресата. NULL = код привязки ещё не отработал, '
  'слать нельзя: чей это чат, мы пока не знаем.';

comment on column public.hf_alert_state.notified_hf is
  'HF, при котором ушло ПОСЛЕДНЕЕ СООБЩЕНИЕ (не последнее наблюдение). '
  'От него считается правило «упал на 10%»: мерить шаг между соседними '
  'прогонами значило бы не заметить медленное сползание.';

comment on column public.hf_alert_state.zone is
  'Зона последнего уведомления. stale = «HF не читается дольше порога»: '
  'слепота — состояние, а не пробел в данных, иначе молчание неотличимо '
  'от «всё хорошо».';
