-- =============================================================================
-- api_call_log: счетчики вызовов внешних API с первого дня (ТЗ Часть 4 §2).
-- Одна строка на исходящий батч; units = количество «единиц» квоты
-- (для CoinGecko — 1 вызов, для RPC — количество запросов в батче).
-- Доступ только service_role: RLS включен, политик нет + явный revoke.
-- =============================================================================

create table public.api_call_log (
  id        bigint generated always as identity primary key,
  provider  text not null check (provider in ('coingecko', 'alchemy', 'rpc', 'zerion')),
  -- Что именно вызывали: 'simple/token_price/base', 'multicall:arbitrum', ...
  endpoint  text not null,
  units     integer not null default 1 check (units > 0),
  ok        boolean not null default true,
  called_at timestamptz not null default now()
);

-- Агрегации вида «вызовов за день» для алерта на 70% лимита
create index api_call_log_provider_called_at_idx
  on public.api_call_log (provider, called_at);

alter table public.api_call_log enable row level security;

revoke all on public.api_call_log from anon, authenticated;
