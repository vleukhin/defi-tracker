-- =============================================================================
-- Фаза 8. Память об отработанных уровнях GM и границы циклов (docs/09).
--
-- Под словом «пройден» у уровня GM сегодня слиты два разных факта, и рождают
-- их разные стороны. «Цена сейчас не выше уровня» порождает рынок, и это
-- приложение видит само. «GM на уровне проданы и откуплены» порождает
-- владелец, и вывести это из данных нельзя в принципе: продажа 30% GM меняет
-- стоимость позиции ровно так же, как её меняет падение цены. После отскока
-- первый факт гаснет, а второй остаётся верным — и именно он отвечает на
-- вопрос «что делать при следующем падении».
--
-- ПОЧЕМУ НЕ ХВАТИЛО signal_acks. Механика отметок там уже есть, но носителем
-- для уровней GM таблица быть перестаёт: объём операции в неё не положить.
-- Она общая для трёх видов сигналов, а колонки «продано GM» и «откуплено
-- на сумму» осмысленны ровно для одного из них. Уровни GM уезжают в
-- собственный журнал, clmm-ready остаётся в signal_acks как есть.
--
-- ПОЧЕМУ ОТМЕТКА — ЭТО ЗАПИСЬ С ОБЪЁМОМ, А НЕ ФЛАГ. Урок 12 называет
-- количество токенов ключевым параметром, и обоснование прямое: доллары
-- и цену можно пересчитать задним числом из чего угодно, количество GM —
-- ни из чего. Отметка без него описывала бы событие, но не операцию.
-- Отсюда gm_amount not null: цена решения названа честно — «сделал, цифры
-- позже» не сохранится.
--
-- ПОЧЕМУ ЖУРНАЛ ТОЧЕК ОТСЧЁТА, А НЕ ОДНО ПОЛЕ. Точка подвижна (docs/07 §7):
-- после доведения LTV до целевого её переносят вперёд, и прежний цикл
-- закрывается вместе со своими отметками. Затирание одного поля делало бы
-- стороннюю таблицу владельца единственным носителем истории циклов.
-- Журнал переносов не заменяет учёт слоёв (он остаётся out of scope), но
-- фиксирует границы циклов, а вместе с ними — смысл слова «отработан»:
-- уровень отработан, если есть запись, ссылающаяся на ТЕКУЩУЮ точку.
-- Отдельного флага «отработан» нет намеренно: два носителя одного факта
-- разъезжаются, и docs/07 §10.1 на этом уже обжигался.
--
-- ЧТО ЗДЕСЬ ЯВЛЯЕТСЯ ИСКЛЮЧЕНИЕМ ИЗ ЭТОГО ПРАВИЛА И ПОЧЕМУ. Копия текущей
-- точки остаётся в position_marks (entry_price_usd + новое entry_price_set_at):
-- экран позиций не должен ради точки отсчёта ходить во вторую таблицу.
-- Раз копия допущена — расхождение её с журналом объявляется ошибкой записи,
-- а не допустимым состоянием, и держится это триггером, а не дисциплиной
-- вызывающего кода.
--
-- ПРАВИЛО ПРОЕКТА ПРО ФУНКЦИИ В БД (устанавливается этой миграцией).
-- Функции здесь заводятся только там, где две записи ОБЯЗАНЫ быть одной,
-- и только security invoker. Логика в базе невидима из кода приложения и
-- проверяется только миграцией, поэтому платить эту цену можно лишь за то,
-- что кодом не выражается — за инвариант между двумя таблицами. Запрет
-- на security definer здесь не формальность, см. комментарий у функции.
--
-- Порядок операторов в файле значим: бэкфилл идёт ДО создания триггера,
-- иначе он вхолостую переписал бы position_marks и сдвинул updated_at
-- у всех размеченных позиций.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- position_marks.entry_price_set_at: когда была установлена текущая точка.
--
-- Быстрая копия set_at последней записи gm_reference_points — рядом с копией
-- самой цены. Нужна для подсказки «точку отсчёта переносили N дней назад»
-- (docs/09 S8.4), которая иначе требовала бы второго запроса на экране
-- позиций.
--
-- БЕЗ DEFAULT И БЕЗ now() ЗАДНИМ ЧИСЛОМ. NULL = «момент неизвестен», и для
-- всех точек, заданных до Фазы 8, это единственный честный ответ. Проставить
-- им now() значило бы объявить, что цикл начался сегодня, — а от возраста
-- точки зависит подсказка о переносе.
--
-- Проверка связывает копию с ценой: момент установки без самой цены — это
-- утверждение о точке, которой нет.
-- -----------------------------------------------------------------------------
alter table public.position_marks
  add column if not exists entry_price_set_at timestamptz
    check (entry_price_set_at is null or entry_price_usd is not null);

comment on column public.position_marks.entry_price_set_at is
  'Момент установки текущей точки отсчёта — копия set_at последней записи '
  'gm_reference_points. NULL = момент неизвестен (точка задана до Фазы 8 '
  'или владелец его не назвал), и это НЕ «сегодня».';

-- =============================================================================
-- gm_reference_points: журнал переносов точки отсчёта.
--
-- Одна запись = один цикл. Текущая точка позиции — последняя запись; всё
-- остальное история, которая уровней уже не отмечает, но остаётся читаемой
-- («прошлые циклы» в поповере уровней).
--
-- КЛЮЧ ПОЗИЦИИ НАТУРАЛЬНЫЙ — по той же причине, что у position_marks,
-- balance_marks и signal_acks: строки protocol_positions принадлежат
-- читателям цепочек, они их пересоздают, а CLMM при перезаливке диапазона
-- выдаёт новый tokenId. Ссылка на id позиции пережила бы не всякое чтение.
-- =============================================================================

create table public.gm_reference_points (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  protocol    text not null check (protocol in ('fluid', 'gmx_v2', 'uni_v3')),
  chain       text not null check (chain in ('ethereum', 'arbitrum', 'base', 'optimism')),
  external_id text not null check (length(external_id) between 1 and 200),
  -- Цена базового актива рынка: у GM BTC/USDC — цена BTC, у GM ETH/USDC — ETH.
  -- Ноль запрещён не как «нет данных», а как деление на ноль: от нуля падение
  -- не считается
  price_usd   numeric not null check (price_usd > 0),
  -- Когда точка была установлена. NULL = момент неизвестен: бэкфилл и ручной
  -- ввод старой цены имеют право не знать даты, а now() соврал бы
  set_at      timestamptz,
  source      text not null check (source in ('manual', 'chain', 'current_price')),
  note        text check (note is null or length(note) between 1 and 200),
  created_at  timestamptz not null default now(),
  -- Мишень составного внешнего ключа из gm_level_actions. Без этой пары
  -- ссылаться пришлось бы на один id — и тогда чужую точку можно было бы
  -- указать в своей записи журнала, потому что проверки ссылочной целостности
  -- идут в обход RLS и чужую строку прекрасно видят
  unique (user_id, id)
);

-- Горячий путь: «все точки этой позиции, свежие первыми» — и текущая точка
-- как limit 1 из него же. Первичный ключ по id такую выборку не покрывает
create index gm_reference_points_position_idx
  on public.gm_reference_points (user_id, protocol, chain, external_id, created_at desc);

alter table public.gm_reference_points enable row level security;

create policy "gm_reference_points: owner full access"
  on public.gm_reference_points
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table public.gm_reference_points is
  'Журнал переносов точки отсчёта падения GM (docs/07 §7, docs/09 S8.2). '
  'Текущая точка позиции = order by created_at desc, id desc limit 1. '
  'Тайбрейк по id обязателен: now() в default — время НАЧАЛА ТРАНЗАКЦИИ, '
  'поэтому две записи одной транзакции получают ровно один created_at. Без '
  'второго ключа сортировки «текущая точка» зависела бы от плана запроса, '
  'а вместе с ней — отмечены уровни или нет. Что тайбрейк по случайному uuid '
  'НЕ делает: он даёт ответ устойчивый, а не хронологический. Порядок двух '
  'точек одной транзакции им не восстановить, и полагаться на это нельзя — '
  'перенос точки должен оставаться одной записью за транзакцию.';

comment on column public.gm_reference_points.set_at is
  'Когда точка была установлена (а не когда создана запись — это created_at). '
  'NULL = момент неизвестен. Точки, заведённые бэкфиллом Фазы 8, все такие.';

comment on column public.gm_reference_points.source is
  'Откуда взялась цена: manual — ввёл владелец, chain — выбрана из фактических '
  'операций с GM в блокчейне (docs/09 S8.5), current_price — подставлена '
  'текущая цена оракула на момент переноса.';

comment on column public.gm_reference_points.created_at is
  'Момент появления записи. В отличие от set_at, есть всегда — поэтому '
  'порядок циклов определяется именно им.';

-- =============================================================================
-- gm_level_actions: журнал операций по уровням.
--
-- Запись = одна операция с GM на одном уровне. Ключ суррогатный (id), а не
-- пара «пользователь + уровень»: на одном уровне операций несколько —
-- продажа и обратная покупка это разные события, а на −30/−50/−70 к ним
-- добавляется покупка из Stability (docs/07 §5).
--
-- НАТУРАЛЬНЫЙ КЛЮЧ ПОЗИЦИИ СЮДА НЕ ДЕНОРМАЛИЗУЕТСЯ. Он выводится через
-- reference_point_id, а вторая копия — это второй носитель одного факта,
-- то есть ровно то, чего эта фаза избегает в определении «отработан».
-- Цена вопроса — join к gm_reference_points при выборке по позиции; она
-- меньше цены расхождения.
-- =============================================================================

create table public.gm_level_actions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  -- Точка отсчёта, при которой сделана операция. Отсюда следует «отработан»:
  -- уровень отмечен, если есть запись, ссылающаяся на текущую точку позиции
  reference_point_id uuid not null,
  -- Уровень падения в процентах, как их хранит GM_DROP_LEVELS. Минус 50 —
  -- это НЕ падение: так записан ориентир РОСТА +50% (docs/07 §6), который
  -- в той же колонке столкнулся бы с уровнем падения 50. Значения перечислены
  -- явно, а не диапазоном: между ними нет промежуточных
  drop_percent       smallint not null check (drop_percent in (7, 15, 30, 50, 70, -50)),
  kind               text not null check (kind in ('sell', 'buy')),
  -- Количество GM-токенов. Единственная величина, которую нельзя пересчитать
  -- задним числом ни из чего, — поэтому not null (решение владельца, docs/09)
  gm_amount          numeric not null check (gm_amount > 0),
  -- Откуда деньги на покупку: proceeds — выручка от продажи GM на этом же
  -- уровне, stability — СОБСТВЕННЫЕ стейблы из Stability Zone, yield_reserve —
  -- стейбл-резерв заёмных внутри Yield. Различать нужно не для статистики:
  -- stability это свои деньги, остальные два — заёмные, а по docs/07 §10.1a
  -- это разные зоны и разное отношение к категориям
  funds_source       text check (funds_source is null or funds_source in ('proceeds', 'stability', 'yield_reserve')),
  -- Три необязательные величины. NULL ≠ 0 по общему правилу проекта: пустое
  -- поле значит «не сказали», ноль — «нисколько». Автоматически достраивать
  -- одну из двух других нельзя: вычисленное число выглядело бы как записанное
  asset_amount       numeric check (asset_amount is null or asset_amount >= 0),
  usd_amount         numeric check (usd_amount is null or usd_amount >= 0),
  asset_price_usd    numeric check (asset_price_usd is null or asset_price_usd > 0),
  -- КОГДА ОПЕРАЦИЯ БЫЛА, а не когда её отметили (для второго есть created_at).
  -- Отмечают задним числом, и подставить время отметки значило бы записать
  -- неверную дату в единственный журнал, где она вообще есть.
  --
  -- Проверки «не в будущем» здесь нет намеренно: now() не immutable, в check
  -- его класть нельзя, а если обойти запрет — восстановление из дампа падало
  -- бы на строках, законных в момент записи. Границу держит форма.
  happened_at        timestamptz not null,
  note               text check (note is null or length(note) between 1 and 200),
  created_at         timestamptz not null default now(),

  -- Источник денег у продажи бессмыслен, а разрешённый NULL у покупки означал
  -- бы «не сказали» — а сказать здесь обязательно, иначе величина не сложится
  -- в базу объёма Stability за цикл (docs/07 §10.3). Держится базой, а не
  -- только формой: у журнала будет не один пишущий путь
  constraint gm_level_actions_funds_source_matches_kind check (
    (kind = 'buy' and funds_source is not null)
    or (kind = 'sell' and funds_source is null)
  ),

  -- ПОЧЕМУ КЛЮЧ СОСТАВНОЙ, А НЕ ПРОСТО reference_point_id. Проверки ссылочной
  -- целостности выполняются в обход RLS и видят все строки таблицы. Ссылка
  -- по одному id прошла бы на чужую точку отсчёта, и запись журнала легально
  -- указывала бы на цикл другого пользователя. Пара (user_id, id) делает это
  -- невозможным на уровне базы: сослаться можно только на свою точку.
  --
  -- ПОЧЕМУ NO ACTION DEFERRABLE, А НЕ RESTRICT. Запрет удалять точку, на
  -- которую ссылаются записи, нужен (docs/09 S8.4: «сначала записи»), но
  -- RESTRICT срабатывает НЕМЕДЛЕННО и отложить его нельзя. При удалении
  -- аккаунта каскады от auth.users приходят в обе таблицы в неопределённом
  -- порядке, и если gm_reference_points вычистится первой, RESTRICT сорвал бы
  -- удаление пользователя целиком. NO ACTION с отложенной проверкой даёт то
  -- же ограничение в обычной работе (ошибка в конце транзакции), но внутри
  -- одной транзакции каскадного удаления порядок перестаёт иметь значение.
  constraint gm_level_actions_point_fk
    foreign key (user_id, reference_point_id)
    references public.gm_reference_points (user_id, id)
    on delete no action
    deferrable initially deferred
);

-- «Все операции этого цикла» — выборка, из которой строится признак
-- отработанности каждого уровня на шкале
create index gm_level_actions_point_idx
  on public.gm_level_actions (user_id, reference_point_id);

alter table public.gm_level_actions enable row level security;

create policy "gm_level_actions: owner full access"
  on public.gm_level_actions
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table public.gm_level_actions is
  'Журнал операций с GM по уровням стратегии (docs/09 S8.1). Уровень отработан '
  '= есть хотя бы одна запись, ссылающаяся на текущую точку отсчёта позиции; '
  'отдельного флага нет. Натуральный ключ позиции здесь не хранится — он '
  'выводится через reference_point_id.';

comment on column public.gm_level_actions.drop_percent is
  'Уровень: 7/15/30/50/70 — проценты ПАДЕНИЯ от точки отсчёта (docs/07 §5). '
  'Значение -50 — ориентир РОСТА +50% (§6); минус означает «вверх», а не '
  'отрицательное падение. На экране он остаётся «+50%».';

comment on column public.gm_level_actions.gm_amount is
  'Количество GM-токенов в операции. Обязательно: доллары и цена '
  'пересчитываются задним числом из чего угодно, количество — ни из чего.';

comment on column public.gm_level_actions.funds_source is
  'Только у покупки: proceeds — выручка от продажи GM на этом же уровне, '
  'stability — собственные стейблы Stability Zone, yield_reserve — стейбл-'
  'резерв заёмных внутри Yield. У продажи всегда NULL, это проверяется базой.';

comment on column public.gm_level_actions.happened_at is
  'Когда операция была. Отделён от created_at намеренно: отмечают задним '
  'числом, и время отметки — не время операции.';

comment on column public.gm_level_actions.asset_amount is
  'Сколько базового актива получено (у продажи) или внесено (у покупки). '
  'NULL = не сказали, и это НЕ ноль.';

comment on column public.gm_level_actions.usd_amount is
  'Сумма операции в долларах. NULL = не сказали, и это НЕ ноль.';

comment on column public.gm_level_actions.asset_price_usd is
  'Цена базового актива на момент операции. NULL = не сказали.';

-- =============================================================================
-- Бэкфилл: точка отсчёта для каждой позиции, где цена входа уже задана.
--
-- Нужен для того, чтобы ссылка gm_level_actions.reference_point_id всегда
-- разрешалась: без него первая же отметка на давно заведённом пуле упиралась
-- бы в отсутствие точки, хотя цена входа у владельца стоит с Фазы 7.
--
-- set_at = NULL, А НЕ now(). Когда именно была установлена эта цена, не знает
-- никто: колонка entry_price_usd момента не хранила. now() объявил бы, что
-- цикл начался в день миграции, и подсказка «точку переносили N дней назад»
-- (docs/09 S8.4) на следующий день начала бы врать с уверенным видом.
-- Порядок записей при этом определим и без set_at — по created_at.
--
-- source = 'manual': до Фазы 8 цена входа вводилась только руками, других
-- путей у неё не было. note не заполняется — придумывать за владельца нечего.
-- =============================================================================

insert into public.gm_reference_points (
  user_id, protocol, chain, external_id, price_usd, set_at, source, note
)
select
  user_id, protocol, chain, external_id, entry_price_usd, null, 'manual', null
from public.position_marks
where protocol = 'gmx_v2'
  and entry_price_usd is not null;

-- =============================================================================
-- Синхронизация быстрой копии точки в position_marks.
--
-- Заводится СТРОГО ПОСЛЕ бэкфилла: иначе бэкфилл вхолостую переписал бы
-- position_marks теми же значениями и сдвинул updated_at у всех размеченных
-- позиций, соврав про момент последней правки разметки.
--
-- ПОЧЕМУ SECURITY INVOKER И ПОЧЕМУ DEFINER ЗДЕСЬ ЗАПРЕЩЁН. С definer функция
-- писала бы в position_marks правами владельца, в обход RLS, а user_id брала
-- бы из строки-триггера. Достаточно было бы одной строки gm_reference_points
-- с чужим user_id — и она молча переписала бы цену входа в ЧУЖОЙ разметке.
-- С invoker обе стороны проверяются политиками: чужую точку не вставить,
-- а если бы она взялась, писать по ней в чужой position_marks всё равно
-- нечем. Прав invoker хватает ровно потому, что синхронизируются строки
-- одного и того же пользователя.
--
-- Триггер слушает insert / delete / update ИМЕННО price_usd и set_at:
-- правка note или source копию не меняет, и будить триггер незачем.
-- =============================================================================

create function public.gm_reference_point_sync()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row      public.gm_reference_points;
  v_price    numeric;
  v_set_at   timestamptz;
begin
  -- У delete значим old, у остальных — new; натуральный ключ позиции в них
  -- один и тот же (он не меняется правкой цены)
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  -- Текущая точка позиции ПОСЛЕ изменения. Тайбрейк по id обязателен:
  -- две записи одной транзакции получают одинаковый now()
  select p.price_usd, p.set_at
    into v_price, v_set_at
    from public.gm_reference_points p
   where p.user_id = v_row.user_id
     and p.protocol = v_row.protocol
     and p.chain = v_row.chain
     and p.external_id = v_row.external_id
   order by p.created_at desc, p.id desc
   limit 1;

  if tg_op = 'DELETE' then
    -- ТОЛЬКО update, НИКОГДА insert. При удалении аккаунта каскад чистит обе
    -- таблицы, и upsert здесь воскресил бы строку position_marks уже
    -- удаляемого пользователя — она осталась бы мусором, привязанным
    -- к несуществующему auth.users. Если точек не осталось, v_price = NULL,
    -- и копия честно становится «точка не задана».
    update public.position_marks
       set entry_price_usd    = v_price,
           entry_price_set_at = v_set_at,
           updated_at         = now()
     where user_id     = v_row.user_id
       and protocol    = v_row.protocol
       and chain       = v_row.chain
       and external_id = v_row.external_id;
  else
    -- Здесь именно upsert: точку отсчёта переносят у пула, которому разметки
    -- (зоны, доли своих средств) могли ещё ни разу не задать, и требовать
    -- её заранее значило бы требовать лишнего действия перед первым переносом.
    insert into public.position_marks (
      user_id, protocol, chain, external_id,
      entry_price_usd, entry_price_set_at, updated_at
    )
    values (
      v_row.user_id, v_row.protocol, v_row.chain, v_row.external_id,
      v_price, v_set_at, now()
    )
    on conflict (user_id, protocol, chain, external_id) do update
      set entry_price_usd    = excluded.entry_price_usd,
          entry_price_set_at = excluded.entry_price_set_at,
          updated_at         = excluded.updated_at;
  end if;

  -- after-триггер: возвращаемое значение не используется
  return null;
end;
$$;

comment on function public.gm_reference_point_sync() is
  'Держит position_marks.entry_price_usd / entry_price_set_at равными '
  'последней записи gm_reference_points для той же позиции. Копия допущена '
  'ради экрана позиций, поэтому её расхождение с журналом — ошибка, а не '
  'состояние; функция и есть цена этого решения. Только security invoker: '
  'с definer чужая строка точки отсчёта переписывала бы чужую разметку '
  'в обход RLS. На delete делает исключительно update — upsert воскресил бы '
  'position_marks пользователя, которого каскадно удаляют.';

create trigger gm_reference_points_sync_mark
  after insert or delete or update of price_usd, set_at
  on public.gm_reference_points
  for each row
  execute function public.gm_reference_point_sync();

-- =============================================================================
-- Уборка signal_acks: виды gm-level: и gm-growth: уходят в новый журнал.
--
-- Строки не переносятся, а удаляются: переносить их в журнал нечем — объёма
-- операции в них нет, а придумать его нельзя. Пустая запись с gm_amount,
-- взятым с потолка, была бы хуже отсутствия записи: она выглядела бы как
-- показание владельца. Владелец переотметит уровни, которые считает
-- отработанными, уже с количествами.
--
-- signal_acks после этого обслуживает только clmm-ready: — там отпечаток
-- обстановки по-прежнему нужен, а объёма операции нет по природе сигнала.
-- =============================================================================

delete from public.signal_acks
where signal_key like 'gm-level:%'
   or signal_key like 'gm-growth:%';

-- =============================================================================
-- GRANT'ы: auto_expose_new_tables = off (supabase/config.toml), без них новые
-- таблицы недоступны даже при правильных RLS-политиках.
-- =============================================================================

grant all on
  public.gm_reference_points,
  public.gm_level_actions
to service_role;

grant select, insert, update, delete on
  public.gm_reference_points,
  public.gm_level_actions
to authenticated;
