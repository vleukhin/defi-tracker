-- Явные GRANT'ы: новый дефолт Supabase (auto_expose_new_tables = off) не выдает
-- ролям anon/authenticated/service_role права на новые таблицы автоматически.
-- Доступ по строкам по-прежнему ограничивает RLS; здесь — только табличный уровень.

grant usage on schema public to anon, authenticated, service_role;

-- service_role: полный доступ ко всем таблицам (админ-клиент, cron, сиды)
grant all on all tables in schema public to service_role;

-- authenticated: CRUD на user-scoped таблицах (RLS режет по auth.uid())
grant select, insert, update, delete on
  public.wallets,
  public.buckets,
  public.asset_bucket_map,
  public.target_allocations,
  public.trades,
  public.manual_holdings,
  public.snapshots,
  public.snapshot_items,
  public.borrow_links
to authenticated;

-- authenticated: только чтение справочных/кэшевых таблиц (запись — service_role)
grant select on
  public.assets,
  public.price_cache,
  public.balances_cache,
  public.protocol_positions
to authenticated;

-- api_call_log остается закрытым для anon/authenticated (revoke в предыдущей миграции)
revoke all on public.api_call_log from anon, authenticated;
