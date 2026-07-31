-- =============================================================================
-- Фаза 6: зоны стратегии Capital Growth и собственный капитал в позициях.
-- Стратегия: docs/07-strategia-capital-growth.md
--
-- Зоны — НЕ переименование трех категорий. Это другой разрез:
--   категории (btc / eth / stable) отвечают «в чем лежит»;
--   зоны (growth / yield / stability) — «какую задачу решает».
-- Стейблкоины есть и в Stability, и в Yield, поэтому одно через другое
-- не выражается.
--
-- -----------------------------------------------------------------------------
-- ЗАЧЕМ ЖУРНАЛ own_capital_placements (главное здесь)
-- -----------------------------------------------------------------------------
-- Фаза 5 вычитала собственные стейблы только из депозита Fluid, потому что
-- предполагалось, что свои деньги лежат именно там. Это оказалось неверно уже
-- на момент выпуска: 14 600 собственных были сняты с Fluid и добавлены в
-- CLMM-позицию (docs/07 §9.4). Собственная часть попадала в «Активы» дважды —
-- один раз ручной записью категории «Стейблы», второй раз в составе позиции.
--
-- Заплатка «вычитать еще и из LP» протухла бы при следующем переносе средств.
-- Поэтому вычитается не протокол, а ЯВНО ОБЪЯВЛЕННАЯ величина:
--
--   Активы = портфель + позиции − размещено_своих
--
-- где размещено_своих — сумма журнала. Журнал, а не одно число, по той же
-- причине, что и deposits: иначе прошлое нельзя ни проверить, ни исправить.
--
-- Почему не «доля собственных у позиции»: по стратегии CLMM-позиции регулярно
-- закрываются и открываются заново с новым диапазоном, то есть с новым
-- tokenId. Признак, привязанный к позиции, терялся бы при каждой перезаливке,
-- хотя деньги остаются теми же самыми.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- own_capital_placements: собственные средства, вложенные в читаемые позиции.
--
-- amount ПОДПИСАННАЯ: положительная — свои деньги ушли в позицию,
-- отрицательная — вернулись обратно в свободные стейблы. Ноль запрещен.
--
-- from_zone — откуда деньги взяты: на эту зону уменьшается остаток свободных
-- средств. По умолчанию Stability: именно она по стратегии служит источником
-- капитала для подпитки Yield Zone.
-- -----------------------------------------------------------------------------
create table public.own_capital_placements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  amount      numeric not null check (amount <> 0),
  from_zone   text not null default 'stability'
              check (from_zone in ('growth', 'yield', 'stability')),
  happened_on date not null,
  note        text check (note is null or length(note) <= 200),
  created_at  timestamptz not null default now()
);

create index own_capital_placements_user_idx
  on public.own_capital_placements (user_id, happened_on);

alter table public.own_capital_placements enable row level security;

create policy "own_capital_placements: owner full access"
  on public.own_capital_placements
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table public.own_capital_placements is
  'Журнал собственных средств, размещенных в читаемых позициях. Сумма '
  'вычитается из Активов, чтобы своя часть не считалась дважды: один раз '
  'ручной записью портфеля, второй — в составе позиции.';

-- -----------------------------------------------------------------------------
-- position_zones: зона позиции, назначенная пользователем.
--
-- Отдельная таблица, а не колонка в protocol_positions: те строки принадлежат
-- читателям цепочек — они их пересоздают и удаляют при закрытии позиции.
-- Пользовательская разметка не должна зависеть от жизненного цикла чтения.
--
-- Ключ — натуральный (протокол, сеть, external_id), а не id строки позиции:
-- при перезаливке диапазона CLMM выдает новый tokenId, и разметка по id
-- терялась бы. По новому tokenId сработает зона по умолчанию — для CLMM это
-- Yield, что и требуется.
-- -----------------------------------------------------------------------------
create table public.position_zones (
  user_id     uuid not null references auth.users (id) on delete cascade,
  protocol    text not null check (protocol in ('fluid', 'gmx_v2', 'uni_v3')),
  chain       text not null check (chain in ('ethereum', 'arbitrum', 'base', 'optimism')),
  external_id text not null,
  zone        text not null check (zone in ('growth', 'yield', 'stability')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, protocol, chain, external_id)
);

alter table public.position_zones enable row level security;

create policy "position_zones: owner full access"
  on public.position_zones
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- manual_positions.zone: зона ручной записи.
--
-- NULL допустим и означает «не размечено» — тогда зона выводится из категории
-- (стейблы → Stability, btc/eth → Growth). Именно NULL, а не DEFAULT 'stability':
-- иначе ручная запись в BTC получила бы Stability и попала бы в зону, которая
-- по стратегии состоит из одних стейблкоинов, а отличить умолчание от
-- осознанного выбора пользователя было бы уже нельзя.
-- -----------------------------------------------------------------------------
alter table public.manual_positions
  add column if not exists zone text
    check (zone is null or zone in ('growth', 'yield', 'stability'));

comment on column public.manual_positions.zone is
  'Зона стратегии; NULL = вывести из категории. Не выводится из категории '
  'жестко: стейблкоины есть и в Stability, и в Yield — это разные задачи '
  'одних и тех же монет.';

-- =============================================================================
-- GRANT'ы: auto_expose_new_tables = off, без них новые таблицы недоступны
-- даже при правильных RLS-политиках.
-- =============================================================================

grant all on
  public.own_capital_placements,
  public.position_zones
to service_role;

grant select, insert, update, delete on
  public.own_capital_placements,
  public.position_zones
to authenticated;
