-- =============================================================================
-- Фаза 4: долг, внесенные средства и health factor (docs/03-fazy-2-6.md).
--
-- Методика (утверждена и обязательна):
--   «Внесено» — только собственные деньги, заведенные извне; заемные средства
--   и прибыль от них взносами не считаются.
--     Чистая  = Активы − Долг
--     Прибыль = Чистая − Внесено
--   Портфель (три категории, доли, отклонения) долг НЕ затрагивает —
--   это отдельный контур учета.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- deposits: журнал собственных средств (S4.0). Не одно число, а история —
-- иначе нельзя ни проверить, ни исправить прошлое.
-- amount ПОДПИСАННАЯ: положительная — пополнение, отрицательная — вывод
-- собственных средств. Ноль запрещен: такая запись ничего не значит.
-- -----------------------------------------------------------------------------
create table public.deposits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  amount      numeric not null check (amount <> 0),
  happened_on date not null,
  note        text check (note is null or length(note) <= 200),
  created_at  timestamptz not null default now()
);

create index deposits_user_id_happened_on_idx
  on public.deposits (user_id, happened_on);

alter table public.deposits enable row level security;

create policy "deposits: owner full access"
  on public.deposits
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- aave_account_health: тотals и health factor по (кошелек, сеть) из
-- Pool.getUserAccountData — КАНОНИЧЕСКИЙ источник Долга и HF (оракул Aave).
-- Активы портфеля при этом оцениваются через CoinGecko; небольшое расхождение
-- базисов принято осознанно.
--
-- health_factor NULL = долга нет (uint256.max, «∞») — фейковое огромное число
-- не хранится никогда. Записи обновляет только service_role; упавшее чтение
-- сети НЕ стирает последние известные строки.
-- -----------------------------------------------------------------------------
create table public.aave_account_health (
  wallet_id            uuid not null references public.wallets (id) on delete cascade,
  chain                text not null check (chain in ('ethereum', 'arbitrum', 'base', 'optimism')),
  total_collateral_usd numeric check (total_collateral_usd is null or total_collateral_usd >= 0),
  total_debt_usd       numeric check (total_debt_usd is null or total_debt_usd >= 0),
  health_factor        numeric check (health_factor is null or health_factor >= 0),
  checked_at           timestamptz not null default now(),
  primary key (wallet_id, chain)
);

alter table public.aave_account_health enable row level security;

-- Чтение — владелец кошелька (тот же паттерн, что chain_read_status);
-- запись — только service_role (grant'ов на запись у authenticated нет).
create policy "aave_account_health: owner read via wallet"
  on public.aave_account_health
  for select
  to authenticated
  using (
    exists (
      select 1 from public.wallets w
      where w.id = aave_account_health.wallet_id
        and w.user_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- user_settings: настройки пользователя. Пока одно поле — порог предупреждения
-- по health factor (S4.1/S4.3, по умолчанию 1.5, строго больше 1: порог ниже
-- единицы означал бы «предупреждать после ликвидации»).
-- -----------------------------------------------------------------------------
create table public.user_settings (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  hf_warning_threshold numeric not null default 1.5 check (hf_warning_threshold > 1),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "user_settings: owner full access"
  on public.user_settings
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- snapshots.debt_usd: долг на дату снепшота. Как и composition — величина,
-- невосстановимая задним числом (Aave не дает исторический getUserAccountData).
-- NULL = на момент съема долг известен не был («нет данных» ≠ «ноль»).
--
-- «Внесено» в снепшот НЕ пишется: журнал deposits хранит даты, и сумма
-- на любую дату восстановима реплеем — снепшотится только невосстановимое.
-- -----------------------------------------------------------------------------
alter table public.snapshots
  add column if not exists debt_usd numeric check (debt_usd is null or debt_usd >= 0);

comment on column public.snapshots.debt_usd is
  'Суммарный долг Aave на момент съема (оракул Aave). NULL = долг не был прочитан ни разу.';

-- -----------------------------------------------------------------------------
-- chain_read_status: новый источник — чтение долга/HF. Отдельно от 'aave_v3'
-- (залог): залог и долг читаются разными вызовами, и деградировать они могут
-- независимо; снепшот помечается частичным при отказе любого из них.
-- -----------------------------------------------------------------------------
alter table public.chain_read_status
  drop constraint chain_read_status_source_check;

alter table public.chain_read_status
  add constraint chain_read_status_source_check
  check (source in ('aave_v3', 'aave_v3_debt', 'erc20'));

-- =============================================================================
-- GRANT'ы: auto_expose_new_tables = off — без явных GRANT'ов новые таблицы
-- недоступны даже при правильных RLS-политиках.
-- =============================================================================

grant all on
  public.deposits,
  public.aave_account_health,
  public.user_settings
to service_role;

grant select, insert, update, delete on
  public.deposits,
  public.user_settings
to authenticated;

-- aave_account_health: только чтение (пишет читатель под service_role)
grant select on public.aave_account_health to authenticated;
