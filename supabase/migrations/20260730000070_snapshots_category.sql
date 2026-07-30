-- =============================================================================
-- Фаза 3 (S3.1/S3.2): снепшоты портфеля в модели ТРЕХ КАТЕГОРИЙ.
--
-- Таблицы snapshots / snapshot_items были заложены в 20260730000000 под старую
-- модель (gross/debt/net, состав по assets.id и кошелькам). Модель портфеля
-- с тех пор изменилась (02-faza-1-mvp.md §2а): три фиксированные категории,
-- долг в учете не участвует вообще. Обе таблицы ПУСТЫ, поэтому переделываются
-- через drop-and-recreate, а не серией alter'ов.
--
-- Важно: drop уносит с собой RLS-политики, индексы и GRANT'ы — все они
-- пересоздаются здесь (в 20260730000030_grants.sql права на эти две таблицы
-- уже выданы, но после drop они теряются).
--
-- Ключевое решение: UNIQUE (user_id, taken_on) при taken_on типа date.
-- Именно это делает ежедневный джоб идемпотентным (S3.1: «повторный запуск
-- за тот же день перезаписывает, а не дублирует») — без него ретрай cron'а
-- или нажатие «Снепшот сейчас» плодили бы точки на графике за один день.
-- taken_on — календарный день в UTC (тот же часовой пояс, что и расписание
-- cron'а 03:00 UTC); taken_at хранит точный момент съема для отображения.
-- =============================================================================

drop table if exists public.snapshot_items;
drop table if exists public.snapshots;

-- -----------------------------------------------------------------------------
-- snapshots: одна строка = состояние портфеля пользователя на календарный день
-- -----------------------------------------------------------------------------
create table public.snapshots (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- Календарный день (UTC) — ключ идемпотентности
  taken_on   date not null,
  -- Точный момент съема: ежедневный джоб и ручной снепшот дают разное время
  taken_at   timestamptz not null default now(),
  total_usd  numeric not null default 0 check (total_usd >= 0),
  -- true = данные заведомо неполные (упала сеть или цена устарела/отсутствует).
  -- Молча неверная точка истории хуже честно помеченной.
  is_partial boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, taken_on)
);

-- Отдельный индекс не нужен: unique (user_id, taken_on) уже покрывает
-- и выборку периода (user_id + диапазон дат), и сортировку по дню.

alter table public.snapshots enable row level security;

create policy "snapshots: owner full access"
  on public.snapshots
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- snapshot_items: состав снепшота — ровно три строки (btc / eth / stable).
--
-- quantity и price_usd nullable осознанно: если цены категории нет вообще,
-- количество в BTC/ETH-эквиваленте не выводится, и записать 0 значило бы
-- соврать («нет данных» ≠ «ноль»). value_usd при этом честный: 0.
-- Средняя цена покупки и P/L здесь НЕ хранятся — они выводятся из журнала
-- сделок, который уже сохранен целиком; снепшот фиксирует состояние портфеля.
-- -----------------------------------------------------------------------------
create table public.snapshot_items (
  id             uuid primary key default gen_random_uuid(),
  snapshot_id    uuid not null references public.snapshots (id) on delete cascade,
  category       text not null check (category in ('btc', 'eth', 'stable')),
  -- Количество в единицах категории: BTC / ETH / USD
  quantity       numeric,
  price_usd      numeric check (price_usd >= 0),
  value_usd      numeric not null default 0,
  percent        numeric not null default 0,
  -- Разбивка «залог / вручную» (S3.1)
  collateral_usd numeric not null default 0,
  manual_usd     numeric not null default 0,
  unique (snapshot_id, category)
);

alter table public.snapshot_items enable row level security;

-- Доступ через владельца снепшота: своей колонки user_id у состава нет
create policy "snapshot_items: owner access via snapshot"
  on public.snapshot_items
  for all
  to authenticated
  using (
    exists (
      select 1 from public.snapshots s
      where s.id = snapshot_items.snapshot_id
        and s.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.snapshots s
      where s.id = snapshot_items.snapshot_id
        and s.user_id = (select auth.uid())
    )
  );

-- =============================================================================
-- GRANT'ы: auto_expose_new_tables = off, права на пересозданные таблицы
-- не выдаются автоматически (иначе — «permission denied for table»).
-- =============================================================================

grant all on public.snapshots, public.snapshot_items to service_role;

grant select, insert, update, delete on
  public.snapshots,
  public.snapshot_items
to authenticated;
