-- =============================================================================
-- Модель портфеля: ТРИ ФИКСИРОВАННЫЕ КАТЕГОРИИ btc / eth / stable.
--
-- Гибкие корзины (buckets, asset_bucket_map, target_allocations) отменены:
-- в новых схемах они не создаются вовсе (миграции 000000/000010 вычищены),
-- а drop ниже нужен только для локальных БД, накаченных прежней версией.
--
-- Источники количеств:
--   btc / eth — залог (supplied) Aave v3 + ручные записи в монетах;
--   stable    — только ручные записи в USD.
-- Долг (borrow) в этой модели НЕ участвует: учет сознательно независим от него.
--
-- Категория как check-constrained text (а не enum) — единый стиль со
-- assets.kind / wallets.chain, добавление значения не требует ALTER TYPE.
-- =============================================================================

drop table if exists public.target_allocations;
drop table if exists public.asset_bucket_map;
drop table if exists public.buckets;

-- -----------------------------------------------------------------------------
-- portfolio_targets: целевой процент на категорию (максимум 3 строки на юзера)
-- -----------------------------------------------------------------------------
create table public.portfolio_targets (
  user_id    uuid not null references auth.users (id) on delete cascade,
  category   text not null check (category in ('btc', 'eth', 'stable')),
  target_pct numeric(6, 3) not null check (target_pct >= 0 and target_pct <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- PK покрывает и уникальность, и выборку по пользователю
  primary key (user_id, category)
);

alter table public.portfolio_targets enable row level security;

create policy "portfolio_targets: owner full access"
  on public.portfolio_targets
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- manual_positions: помеченные ручные записи («GMX пул» 15000, «Aave USDC» 20000)
-- amount: монеты для btc/eth (BTC, ETH), доллары для stable.
-- -----------------------------------------------------------------------------
create table public.manual_positions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  category   text not null check (category in ('btc', 'eth', 'stable')),
  label      text not null check (length(trim(label)) > 0 and length(label) <= 60),
  amount     numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index manual_positions_user_id_idx on public.manual_positions (user_id, category);

alter table public.manual_positions enable row level security;

create policy "manual_positions: owner full access"
  on public.manual_positions
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- coin_prices: общий кэш цен по coingecko id (TTL 5 мин в коде).
-- Отдельно от price_cache (тот ключуется по assets.id и нужен generic-ридеру
-- ERC-20): цены категорий (bitcoin/ethereum) и залоговых токенов Aave
-- запрашиваются одним /simple/price по id, без строк в справочнике assets.
-- Чтение — authenticated; запись — только service_role.
-- -----------------------------------------------------------------------------
create table public.coin_prices (
  coingecko_id text primary key check (length(trim(coingecko_id)) > 0),
  price_usd    numeric not null check (price_usd >= 0),
  source       text not null default 'coingecko' check (source in ('coingecko', 'derived')),
  fetched_at   timestamptz not null default now()
);

alter table public.coin_prices enable row level security;

create policy "coin_prices: readable by authenticated"
  on public.coin_prices
  for select
  to authenticated
  using (true);

revoke insert, update, delete on public.coin_prices from anon, authenticated;

-- -----------------------------------------------------------------------------
-- chain_read_status: результат последнего чтения сети по кошельку.
-- Нужен, чтобы GET /api/portfolio (только кэш, без RPC) честно показывал
-- деградацию сети: ok = false + причина. Отказ сети НИКОГДА не обнуляет данные.
-- -----------------------------------------------------------------------------
create table public.chain_read_status (
  wallet_id  uuid not null references public.wallets (id) on delete cascade,
  -- Источник чтения: залог Aave (путь портфеля) или generic ERC-20 (Фаза 5)
  source     text not null check (source in ('aave_v3', 'erc20')),
  chain      text not null check (chain in ('ethereum', 'arbitrum', 'base', 'optimism')),
  ok         boolean not null,
  error      text,
  checked_at timestamptz not null default now(),
  primary key (wallet_id, source, chain)
);

alter table public.chain_read_status enable row level security;

create policy "chain_read_status: owner read via wallet"
  on public.chain_read_status
  for select
  to authenticated
  using (
    exists (
      select 1 from public.wallets w
      where w.id = chain_read_status.wallet_id
        and w.user_id = (select auth.uid())
    )
  );

-- =============================================================================
-- Явные GRANT'ы: auto_expose_new_tables = off, права на новые таблицы
-- не выдаются автоматически (без этого — «permission denied for table»).
-- =============================================================================

grant all on all tables in schema public to service_role;

grant select, insert, update, delete on
  public.portfolio_targets,
  public.manual_positions
to authenticated;

grant select on
  public.coin_prices,
  public.chain_read_status
to authenticated;
