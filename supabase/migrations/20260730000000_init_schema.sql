-- =============================================================================
-- Инициальная схема: DeFi Portfolio Tracker
-- Фаза 1: wallets, assets, price_cache, balances_cache.
-- Фазы 2+ (схема заложена заранее): trades, manual_holdings, snapshots,
--         snapshot_items, protocol_positions, borrow_links.
--
-- Модель портфеля (три фиксированные категории btc/eth/stable) живет
-- в 20260730000040_portfolio_model.sql: portfolio_targets, manual_positions,
-- coin_prices, chain_read_status. Гибких корзин (buckets, asset_bucket_map,
-- target_allocations) в модели больше нет — они никогда не создаются.
--
-- Принципы:
--  * RLS включен на КАЖДОЙ таблице.
--  * User-scoped таблицы: политика user_id = auth.uid();
--    wallet-scoped (balances_cache, protocol_positions) — через join к wallets.
--  * assets и price_cache — общие справочники: чтение для authenticated,
--    запись только service_role (нет write-политик + явный REVOKE).
--  * Сырые балансы: numeric(78,0) (вмещает uint256), decimals smallint.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- wallets: read-only EVM-адреса пользователя
-- -----------------------------------------------------------------------------
create table public.wallets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Адрес в EIP-55 checksum-формате (валидируется приложением)
  address     text not null check (address ~ '^0x[0-9a-fA-F]{40}$'),
  label       text,
  -- Debounce обновления балансов (60 с на кошелек, ТЗ §6.1)
  last_refreshed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, address)
);

create index wallets_user_id_idx on public.wallets (user_id);

alter table public.wallets enable row level security;

create policy "wallets: owner full access"
  on public.wallets
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- assets: общий справочник активов (курируемый allowlist + discovery)
-- Запись — только service_role.
-- -----------------------------------------------------------------------------
create table public.assets (
  id               uuid primary key default gen_random_uuid(),
  chain            text not null check (chain in ('ethereum', 'arbitrum', 'base', 'optimism')),
  -- NULL для нативных монет (ETH); lowercase hex для ERC-20
  contract_address text check (contract_address ~ '^0x[0-9a-f]{40}$'),
  symbol           text not null,
  -- Decimals только из контракта, никогда не предполагать 18 (USDC=6, WBTC=8)
  decimals         smallint not null check (decimals >= 0 and decimals <= 255),
  coingecko_id     text,
  kind             text not null check (kind in ('native', 'erc20', 'aave_supply', 'aave_debt', 'gmx_gm', 'univ3_lp')),
  is_hidden        boolean not null default false,
  created_at       timestamptz not null default now(),
  -- NULLS NOT DISTINCT: не более одной нативной монеты на сеть
  unique nulls not distinct (chain, contract_address, kind),
  check (kind = 'native' or contract_address is not null)
);

alter table public.assets enable row level security;

create policy "assets: readable by authenticated"
  on public.assets
  for select
  to authenticated
  using (true);

-- Запись только через service_role (обходит RLS); явный revoke для надежности
revoke insert, update, delete on public.assets from anon, authenticated;

-- -----------------------------------------------------------------------------
-- price_cache: общий серверный кэш цен (TTL в коде, 5 мин).
-- Чтение — authenticated; запись — только service_role.
-- -----------------------------------------------------------------------------
create table public.price_cache (
  asset_id   uuid primary key references public.assets (id) on delete cascade,
  price_usd  numeric not null check (price_usd >= 0),
  source     text not null check (source in ('coingecko', 'gmx', 'derived')),
  fetched_at timestamptz not null default now()
);

alter table public.price_cache enable row level security;

create policy "price_cache: readable by authenticated"
  on public.price_cache
  for select
  to authenticated
  using (true);

revoke insert, update, delete on public.price_cache from anon, authenticated;

-- -----------------------------------------------------------------------------
-- balances_cache: последнее известное состояние балансов (wallet-scoped)
-- raw_amount: сырое значение из контракта, uint256 вмещается в numeric(78,0)
-- -----------------------------------------------------------------------------
create table public.balances_cache (
  wallet_id  uuid not null references public.wallets (id) on delete cascade,
  asset_id   uuid not null references public.assets (id) on delete cascade,
  raw_amount numeric(78, 0) not null check (raw_amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (wallet_id, asset_id)
);

alter table public.balances_cache enable row level security;

create policy "balances_cache: owner full access via wallet"
  on public.balances_cache
  for all
  to authenticated
  using (
    exists (
      select 1 from public.wallets w
      where w.id = balances_cache.wallet_id
        and w.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.wallets w
      where w.id = balances_cache.wallet_id
        and w.user_id = (select auth.uid())
    )
  );

-- =============================================================================
-- Фаза 2+: схема заложена заранее (ТЗ §5), UI/логика появятся в своих фазах
-- =============================================================================

-- -----------------------------------------------------------------------------
-- trades: ручной леджер сделок (Фаза 2; реплей для средней цены, задел под FIFO)
-- -----------------------------------------------------------------------------
create table public.trades (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  asset_id     uuid references public.assets (id) on delete set null,
  coingecko_id text,
  side         text not null check (side in ('buy', 'sell')),
  quantity     numeric not null check (quantity > 0),
  price_usd    numeric not null check (price_usd >= 0),
  fee_usd      numeric check (fee_usd >= 0),
  traded_at    timestamptz not null,
  note         text,
  created_at   timestamptz not null default now(),
  check (asset_id is not null or coingecko_id is not null)
);

create index trades_user_id_traded_at_idx on public.trades (user_id, traded_at);

alter table public.trades enable row level security;

create policy "trades: owner full access"
  on public.trades
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- manual_holdings: ручные позиции — CEX, холодные кошельки (Фаза 2)
-- -----------------------------------------------------------------------------
create table public.manual_holdings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  asset_id     uuid references public.assets (id) on delete set null,
  coingecko_id text,
  quantity     numeric not null check (quantity >= 0),
  source_label text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (asset_id is not null or coingecko_id is not null)
);

create index manual_holdings_user_id_idx on public.manual_holdings (user_id);

alter table public.manual_holdings enable row level security;

create policy "manual_holdings: owner full access"
  on public.manual_holdings
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- snapshots: дневные снепшоты портфеля (Фаза 3)
-- -----------------------------------------------------------------------------
create table public.snapshots (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  taken_at   timestamptz not null default now(),
  gross_usd  numeric not null default 0,
  debt_usd   numeric not null default 0,
  net_usd    numeric not null default 0,
  is_partial boolean not null default false,
  payload    jsonb,
  created_at timestamptz not null default now()
);

create index snapshots_user_id_taken_at_idx on public.snapshots (user_id, taken_at);

alter table public.snapshots enable row level security;

create policy "snapshots: owner full access"
  on public.snapshots
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- snapshot_items: состав снепшота (scoped через snapshots)
-- -----------------------------------------------------------------------------
create table public.snapshot_items (
  id          uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.snapshots (id) on delete cascade,
  asset_id    uuid not null references public.assets (id) on delete cascade,
  wallet_id   uuid references public.wallets (id) on delete set null,
  quantity    numeric not null,
  price_usd   numeric not null default 0,
  value_usd   numeric not null default 0,
  protocol    text check (protocol in ('aave_v3', 'gmx_v2', 'uni_v3')),
  created_at  timestamptz not null default now()
);

create index snapshot_items_snapshot_id_idx on public.snapshot_items (snapshot_id);

alter table public.snapshot_items enable row level security;

create policy "snapshot_items: owner full access via snapshot"
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

-- -----------------------------------------------------------------------------
-- protocol_positions: текущее состояние DeFi-позиций (Фазы 4-5, wallet-scoped)
-- payload: HF (1e18 => NULL при uint256.max, отображать «∞»), ticks и т.п.
-- -----------------------------------------------------------------------------
create table public.protocol_positions (
  id          uuid primary key default gen_random_uuid(),
  wallet_id   uuid not null references public.wallets (id) on delete cascade,
  protocol    text not null check (protocol in ('aave_v3', 'gmx_v2', 'uni_v3')),
  chain       text not null check (chain in ('ethereum', 'arbitrum', 'base', 'optimism')),
  -- NPM tokenId / адрес рынка и т.п.
  external_id text not null,
  payload     jsonb,
  quantity    numeric,
  value_usd   numeric,
  updated_at  timestamptz not null default now(),
  unique (wallet_id, protocol, chain, external_id)
);

alter table public.protocol_positions enable row level security;

create policy "protocol_positions: owner full access via wallet"
  on public.protocol_positions
  for all
  to authenticated
  using (
    exists (
      select 1 from public.wallets w
      where w.id = protocol_positions.wallet_id
        and w.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.wallets w
      where w.id = protocol_positions.wallet_id
        and w.user_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- borrow_links: привязка займа к размещению заемных средств (Фаза 5)
-- -----------------------------------------------------------------------------
create table public.borrow_links (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  borrow_ref   uuid not null references public.protocol_positions (id) on delete cascade,
  position_ref uuid not null references public.protocol_positions (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (user_id, borrow_ref, position_ref)
);

create index borrow_links_user_id_idx on public.borrow_links (user_id);

alter table public.borrow_links enable row level security;

create policy "borrow_links: owner full access"
  on public.borrow_links
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
