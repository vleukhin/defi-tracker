-- =============================================================================
-- Pendle Finance: четвертый протокол размещения (PT / YT / LP).
--
-- ПРОБЕЛ. Стратегия (docs/07 §3) называет инструментом зоны Stability
-- «покупку principal-токенов на Pendle Finance», а приложение Pendle не
-- читало вовсе. PT можно было завести только ручной записью — то есть
-- суммой, которая не знает ни даты погашения, ни текущего курса, и
-- устаревает в момент ввода. YT и LP на кошельке не видны совсем и
-- выпадают из «Активов» так же, как пулы до Фазы 5.
--
-- ЧТО ЧИТАЕТСЯ. Справочник рынков (адреса PT/YT/LP, дата погашения) —
-- из публичного API Pendle; балансы и курс к базовому активу — с цепочки
-- (balanceOf + PendlePYLpOracle). PT, YT и LP одного рынка — три разные
-- позиции: у них разная задача и, по стратегии, разная зона (PT — Stability,
-- YT/LP — Yield), поэтому external_id = адрес токена, а не рынка.
--
-- Схема хранения не меняется: позиция ложится в protocol_positions с payload
-- kind = 'pendle', разметка — в position_marks по тому же натуральному ключу.
-- Расширяются только списки допустимых значений.
--
-- gm_reference_points и snapshot_items НЕ трогаем: журнал точки отсчета
-- существует только для GM-пулов, а снепшоты разложены по категориям,
-- а не по протоколам.
-- =============================================================================

alter table public.protocol_positions
  drop constraint protocol_positions_protocol_check;

alter table public.protocol_positions
  add constraint protocol_positions_protocol_check
  check (protocol in ('aave_v3', 'fluid', 'gmx_v2', 'uni_v3', 'pendle'));

-- Pendle деградирует отдельно: отказ API Pendle или оракула не должен
-- выглядеть как отказ Fluid или LP
alter table public.chain_read_status
  drop constraint chain_read_status_source_check;

alter table public.chain_read_status
  add constraint chain_read_status_source_check
  check (source in ('aave_v3', 'aave_v3_debt', 'erc20', 'fluid', 'gmx_v2', 'uni_v3', 'pendle'));

-- Ограничение создавалось на таблице position_zones и после переименования
-- в position_marks (20260731000120) сохранило старое имя. Снимаем оба
-- варианта, чтобы миграция не зависела от того, переименовывал ли его кто-то
-- руками.
alter table public.position_marks
  drop constraint if exists position_zones_protocol_check;

alter table public.position_marks
  drop constraint if exists position_marks_protocol_check;

alter table public.position_marks
  add constraint position_marks_protocol_check
  check (protocol in ('fluid', 'gmx_v2', 'uni_v3', 'pendle'));

-- Pendle API — новый внешний источник (api-v2.pendle.finance, бесплатный
-- уровень с лимитом по IP). Считаем вызовы с первого дня, как и остальные.
alter table public.api_call_log
  drop constraint api_call_log_provider_check;

alter table public.api_call_log
  add constraint api_call_log_provider_check
  check (provider in ('coingecko', 'alchemy', 'rpc', 'zerion', 'gmx', 'telegram', 'pendle'));
