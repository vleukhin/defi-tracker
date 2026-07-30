-- =============================================================================
-- Фаза 2: trades переводится на модель трех фиксированных категорий.
--
-- Прежняя форма (asset_id / coingecko_id) была заложена до пересмотра модели
-- портфеля (ТЗ v2): сделки ведутся ПО КАТЕГОРИЯМ btc / eth / stable, как
-- ручные записи и цели, а не по отдельным активам. Таблица пуста (леджер
-- только появляется в этой фазе), поэтому честный drop-and-recreate проще
-- и надежнее цепочки ALTER'ов. Остальные данные пользователя (wallets,
-- manual_positions, portfolio_targets, кэши) миграция не трогает.
--
-- Полный журнал сделок сохраняется как есть — FIFO/лоты можно добавить позже
-- без миграции данных (ТЗ 03 S2.1).
-- =============================================================================

drop table if exists public.trades;

create table public.trades (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  category   text not null check (category in ('btc', 'eth', 'stable')),
  side       text not null check (side in ('buy', 'sell')),
  -- Количество в единицах категории: BTC, ETH или USD для стейблов
  quantity   numeric not null check (quantity > 0),
  -- Цена за единицу в USD на момент сделки
  price_usd  numeric not null check (price_usd >= 0),
  -- Опциональная комиссия в USD; в среднюю цену НЕ входит (формула ТЗ S2.1)
  fee_usd    numeric check (fee_usd >= 0),
  traded_at  timestamptz not null,
  note       text check (length(note) <= 200),
  created_at timestamptz not null default now()
);

-- Реплей леджера и выборки — всегда по пользователю и категории в порядке дат
create index trades_user_category_traded_at_idx
  on public.trades (user_id, category, traded_at);

alter table public.trades enable row level security;

-- DROP TABLE унес прежнюю политику — создать заново (тот же принцип, что везде)
create policy "trades: owner full access"
  on public.trades
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- DROP TABLE унес и GRANT'ы из 20260730000030_grants.sql, а новый дефолт
-- Supabase (auto_expose_new_tables = off) не выдает права автоматически —
-- без явного grant будет «permission denied for table trades».
grant select, insert, update, delete on public.trades to authenticated;
grant all on public.trades to service_role;
