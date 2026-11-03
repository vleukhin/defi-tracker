-- =============================================================================
-- Депозит стейблов на Aave v3 — пятый протокол размещения ('aave_v3_supply').
--
-- ПРОБЕЛ. Залог Aave читался по курируемому списку резервов (chains/aave.ts),
-- и в этом списке только BTC- и ETH-подобные токены: стратегия (docs/07 §1)
-- знает Aave как «залог BTC/ETH, заём в стейблах». Но внесённые на Aave
-- стейблы — это тоже деньги владельца: они лежат под тот же заём, растут
-- по ставке депозита и держат health factor. Приложение их не видело ВОВСЕ:
-- ни в категории «Стейблы», ни в позициях, ни в «Активах».
--
-- ПОЧЕМУ ПОЗИЦИЯ, А НЕ ЗАЛОГ. Стейблы на лендинге — тот же инструмент, что
-- депозит Fluid (docs/07 §3): доход начисляется ставкой, и держат его ровно
-- пока ставка выше ставки по займу. Строкой залога этого не выразить — у
-- залога нет ни ставки, ни зоны, ни разметки «свои / заёмные», а зона у
-- него по стратегии одна, Growth. Поэтому стейбл-депозит ложится в
-- protocol_positions позицией (payload kind = 'aave_supply'), размечается
-- в position_marks по тому же натуральному ключу и закрывается через
-- closed_positions, как любая другая позиция.
--
-- Схема таблиц не меняется — расширяются только списки допустимых значений.
-- =============================================================================

alter table public.protocol_positions
  drop constraint protocol_positions_protocol_check;

alter table public.protocol_positions
  add constraint protocol_positions_protocol_check
  check (protocol in ('aave_v3', 'aave_v3_supply', 'fluid', 'gmx_v2', 'uni_v3', 'pendle'));

-- Депозит деградирует отдельно от залога и долга: он читается своим
-- multicall (aToken.balanceOf + Pool.getReserveData по стейбл-резервам),
-- и его отказ не должен выглядеть отказом залога
alter table public.chain_read_status
  drop constraint chain_read_status_source_check;

alter table public.chain_read_status
  add constraint chain_read_status_source_check
  check (source in ('aave_v3', 'aave_v3_debt', 'aave_v3_supply', 'erc20', 'fluid', 'gmx_v2', 'uni_v3', 'pendle'));

alter table public.position_marks
  drop constraint if exists position_marks_protocol_check;

alter table public.position_marks
  add constraint position_marks_protocol_check
  check (protocol in ('aave_v3_supply', 'fluid', 'gmx_v2', 'uni_v3', 'pendle'));

-- Закрытия: вывод стейблов с Aave — такое же закрытие позиции, как вывод
-- депозита с Fluid. Прежний комментарий к колонке говорил «Aave здесь не
-- бывает» — это было верно, пока на Aave не читалось ничего, кроме залога
-- и долга; состоянием сети стейбл-депозит не является.
alter table public.closed_positions
  drop constraint closed_positions_protocol_check;

alter table public.closed_positions
  add constraint closed_positions_protocol_check
  check (protocol in ('aave_v3_supply', 'fluid', 'gmx_v2', 'uni_v3', 'pendle'));
