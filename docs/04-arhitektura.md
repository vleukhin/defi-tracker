# ТЗ. Часть 4: Техническая архитектура

**Версия:** 1.0 (30.07.2026). Тарифы и лимиты внешних сервисов проверены на 29.07.2026.

---

## 1. Стек (рекомендованный)

| Слой | Выбор | Обоснование |
|---|---|---|
| Приложение | **Next.js (App Router), TypeScript** | Один деплой для UI + API-роутов; SSR для быстрого дашборда |
| Хостинг | **Vercel Pro** ($20/мес с Фазы 6) | Cron любой частоты: мониторингу HF нужны запуски раз в 15 минут, а Hobby даёт один в сутки. До Фазы 6 хватало Hobby ($0) |
| БД + Auth | **Supabase Free** ($0) | Postgres 500 МБ (годы снепшотов для 20 пользователей), Supabase Auth (email+пароль, верификация), **Row Level Security** — изоляция пользователей на уровне БД |
| Блокчейн | **viem** | Типизированный клиент, встроенный multicall-батчинг, ranked fallback-транспорты |
| Джобы | **Vercel Cron** → `/api/cron/snapshot` (сутки) и `/api/cron/health` (15 минут), защита общим `CRON_SECRET` | Оставшись на Hobby, ту же кадансность даёт бесплатный внешний триггер (GitHub Actions schedule / cron-job.org) на те же роуты |

**Альтернатива** (если серверлесс-таймауты станут мешать): Node/Fastify + React SPA на VPS Hetzner (~€4–5/мес) или Railway ($5/мес), Postgres на той же машине, Auth.js/Lucia, node-cron. Снимает лимиты времени выполнения ценой ops.

Ограничение, из-за которого пришлось уйти с Hobby: там cron максимум 1 раз/день с джиттером до 59 мин внутри часа — для дневного снепшота это неважно, а мониторинг HF с такой кадансностью бессмысленен. Таймаут функций остаётся: оба cron-роута обрабатывают пользователей последовательно и по исчерпании мягкого бюджета времени пропускают остаток, чтобы ни одна инвокация не упиралась в лимит.

## 2. Внешние сервисы и бюджет

| Сервис | Тариф | Оценка расхода | $/мес |
|---|---|---|---|
| Alchemy (RPC, 4 сети) | Free: 30M CU/мес, 25 RPS | < 2M CU | $0 |
| dRPC / publicnode | Публичные fallback-RPC | только фолбэк | $0 |
| Zerion API (discovery) | Free Developer: 2 000 req/день, 3 RPS | ~50–100 req/день | $0 |
| CoinGecko | Demo: 10 000 вызовов/мес, ~30/мин (закладываться на 30, не на заявленные 100) | ~3 000 вызовов/мес | $0 |
| GMX prices API (gmxinfra.io) | Публичный, без ключа | 3 вызова на обновление, кэш 5 мин | $0 |
| Vercel | **Pro** | 1 проект, дневной cron + мониторинг HF раз в 15 мин | **$20** |
| Supabase | Free | < 100 МБ | $0 |
| Telegram Bot API | Публичный, без лимита по деньгам | ~1 вызов на прогон плюс сообщения | $0 |
| **Итого** | | | **$20** (бюджет $50 — запас) |

Отвергнутые варианты: **DeBank Cloud** (минимальная покупка units — $200), **Zerion платный** (от $149/мес), **GoldRush/Covalent** (бесплатный тир отменен). Апгрейды при росте (в пределах бюджета): CoinGecko Basic $35/мес (100K вызовов), Vercel Pro $20 + Supabase Pro $25.

Обязательства: счетчики вызовов всех внешних API с первого дня, алерт при 70% лимита; атрибуция CoinGecko в UI.

## 3. Чтение блокчейна

### 3.1. Общее
- Один клиент viem на сеть: `fallback([alchemy, drpc, publicnode])`, multicall-батчинг (`batchSize: 1024`).
- **Multicall3** — `0xcA11bde05977b3631167028862bE2a173976CA11`, одинаковый адрес на всех 4 сетях. Использовать `tryAggregate` / `allowFailure: true`: один реверт не должен ронять батч; упавший вызов трактуется как «неизвестно», не как ноль.
- Все сырые значения — `bigint` + `decimals` из контракта; конвертация через `formatUnits` только на границе отображения. Никогда не предполагать 18 decimals (USDC/USDT = 6, WBTC = 8).

### 3.2. Балансы (Фаза 1)
- Нативный баланс + `balanceOf` по курируемому списку токенов — один multicall на сеть на кошелек.
- Discovery неизвестных токенов/позиций: 1 вызов Zerion `/positions?filter[positions]=no_filter` на кошелек в сутки (внутри cron) → пополнение таблицы `assets` + пометка «неподдерживаемая позиция». Зависимость мягкая: при исчезновении бесплатного тира Zerion теряется удобство discovery, не ядро.

### 3.3. Aave v3 (Фаза 4)
- `Pool.getUserAccountData(user)` → тоталы в базовой валюте (8 decimals) + **health factor (1e18; uint256.max при нулевом долге → отображать «∞», в БД хранить NULL/текст, не переполнять numeric)**.
- `UiPoolDataProvider.getUserReservesData(poolAddressesProvider, user)` → по-активные aToken/долговые балансы.
- Адреса деплоев по сетям — из `@bgd-labs/aave-address-book` (пулы различаются между сетями).

### 3.4. GMX v2 (Фаза 5, Arbitrum) — реализовано
- GM-балансы — обычные ERC-20 (один multicall по списку рынков из `/markets/info`).
- Оракульные цены базовых токенов: REST `https://arbitrum-api.gmxinfra.io/prices/tickers`, справочник decimals — `/tokens`, список рынков — `/markets/info` (все бесплатно).
- **Масштаб цен — `raw / 10^(30 − decimals токена)`, а не `1e30`.** Проверено: ETH (18 знаков) `1885767504879115` → $1885,77; USDC (6 знаков) `999757390000000000000000` → $0,99976. Деление на `1e30` без учета decimals ошибается на порядки.
- Стоимость позиции — ончейн `Reader.getMarketTokenPrice`, а не сумма компонентов: в стоимость пула входит незакрытый PnL трейдеров, контрагентом которых выступает держатель GM. Возвращаемая цена GM — фикс-поинт `1e30`, сам GM-токен 18 знаков.
- Адреса (Arbitrum, из `gmx-io/gmx-synthetics/deployments`): Reader `0x470fbC46bcC0f16532691Df360A07d8Bf5ee0789`, DataStore `0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8`.
- `pnlFactorType` = `keccak256(abi.encode("MAX_PNL_FACTOR_FOR_TRADERS"))` — именно `abi.encode`, не `encodePacked`.
- Декомпозиция на long/short — по `longTokenAmount`/`shortTokenAmount` из того же вызова, пропорционально доле в `totalSupply`.

### 3.5. Uniswap v3 (Фаза 5) — реализовано
- Перечисление позиций: `NonfungiblePositionManager.balanceOf` + `tokenOfOwnerByIndex` + `positions(tokenId)`, затем `factory.getPool` и `slot0()`. Пять зависимых батчей — меньше не выходит, каждый следующий опирается на предыдущий.
- Адреса per-chain: NPM `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` и фабрика `0x1F98431c8aD98523631AE4a59f267346ea31F984` на ethereum/arbitrum/optimism; на **Base** — NPM `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1`, фабрика `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` (подтверждено вызовом `NPM.factory()`).
- Tick math — свой модуль на нативных bigint (`chains/uniswap-math.ts`), без `@uniswap/v3-sdk`: он тянет JSBI ради двух формул. Константы сверены с `MIN_SQRT_RATIO`/`MAX_SQRT_RATIO` контрактов и с живыми пулами.
- Несобранные комиссии — симуляция `collect` с `account = владелец`. `tokensOwed` из `positions()` не годится: обновляется только при действиях с позицией.

### 3.6. Fluid Lending (Фаза 5) — в исходном ТЗ отсутствовал
- Один вызов на сеть: `FluidLendingResolver.getUserPositions(user)` отдает и справочник fToken'ов, и позицию пользователя по каждому.
- Адрес резолвера детерминированный и **одинаков на всех сетях**: `0x48D32f49aFeAEC7AE66ad7B9264f446fc11a1569` (mainnet / arbitrum / base / polygon). На **Optimism Fluid не развернут** — сеть в список не входит.
- `decimals` берется из ответа; проверено на живых контрактах, что у Fluid они совпадают с decimals базового актива, а `underlyingAssets` номинирован именно в нем.
- Оценка — по свежей цене базового токена из `coin_prices` (депозит есть обычный баланс токена), в отличие от GM, где цену дает сам протокол.

## 4. Цены и кэширование

- Единый серверный кэш: таблица `price_cache`, TTL 5 мин; фоновый рефреш не чаще раза в час; метаданные токенов — TTL 24 ч. Браузер в CoinGecko не ходит (ключ, квота, общий кэш).
- Запросы батчами: `/simple/token_price/{platform}?contract_addresses=...` до ~100 адресов за вызов; платформы: `ethereum`, `arbitrum-one`, `base`, `optimistic-ethereum`. Нативные монеты — `/simple/price`.
- Клиент CoinGecko обернут token-bucket-лимитером 25/мин; backoff при 429.
- **Не через CoinGecko**: GM-токены (GMX API), aToken (цена базового актива), LP-позиции (сумма компонентов × цены компонентов). Поле `source` в `price_cache` фиксирует происхождение (`coingecko | gmx | derived`).
- Стейблкоины оцениваются по рынку, не по $1.00 — депеги суть реальные события.

## 5. Модель данных (Postgres + RLS)

```
users               (Supabase auth.users) id, email, created_at
wallets             id, user_id FK, address (EIP-55), label, created_at
assets              id, chain, contract_address, symbol, decimals, coingecko_id?,
                    kind ('native'|'erc20'|'aave_supply'|'aave_debt'|'gmx_gm'|'univ3_lp'),
                    is_hidden bool                       UNIQUE(chain, contract_address, kind)
buckets             id, user_id?, name                   -- NULL user_id = встроенные (BTC/ETH/Stablecoins/Прочее)
asset_bucket_map    asset_id, bucket_id, user_id?        -- переопределения пользователя поверх дефолтов
manual_holdings     id, user_id, asset_or_cg_id, quantity, source_label     -- Фаза 2
trades              id, user_id, asset_ref, side ('buy'|'sell'), quantity,
                    price_usd, traded_at, note -- Фаза 2, реплей для средней
target_allocations  id, user_id, bucket_id, target_pct
protocol_positions  id, wallet_id, protocol ('aave_v3'|'gmx_v2'|'uni_v3'), chain,
                    external_id (NPM tokenId / market addr), payload jsonb (HF, ticks...),
                    quantity, value_usd, updated_at      -- upsert текущего состояния
                    -- borrow_links (Фаза 5) удалена: связка «один заём — одна
                    -- позиция» не описывала реальность, доли не хранились.
                    -- Куда ушёл долг, отвечает разметка в position_marks
price_cache         asset_id, price_usd, source, fetched_at
snapshots           id, user_id, taken_at, gross_usd, debt_usd, net_usd, is_partial, payload jsonb
snapshot_items      snapshot_id FK, asset_id, wallet_id?, quantity, price_usd, value_usd, protocol?
balances_cache      wallet_id, asset_id, raw_amount numeric, updated_at      -- последнее известное состояние
balance_marks       user_id, wallet_id FK, chain, token ('native'|0x…),
                    funds ('own'|'borrowed'), updated_at   -- Фаза 7, PK по всем четырём
                    -- Разметка свободных средств. Отдельно от balances_cache:
                    -- тот принадлежит читателю и удаляет нулевые балансы,
                    -- пометка «заёмные» переживает опустошение баланса.
                    -- Отсутствие строки = «не размечено» (считается своим).
```

- **RLS-политика на каждой user-scoped таблице**: `user_id = auth.uid()`; таблицы, скоупленные кошельком, — через join к `wallets`. Изоляция покрыта автотестами (два пользователя, перекрестные запросы по всем роутам).
- Средняя цена **не хранится** как источник истины — вычисляется реплеем `trades` по `traded_at` (кэш на актив). В `trades` достаточно данных для будущего FIFO без миграции.

## 6. Пайплайны обновления

### 6.1. On-demand refresh (`POST /api/refresh?walletId=`)
1. Debounce: `last_refreshed_at` на кошелек, пол 60 с; внутри окна — отдача кэша.
2. По каждой сети один multicall: нативный баланс + ERC-20 по списку (+ с Фазы 4: `getUserAccountData`; + с Фазы 5: GM-балансы).
3. Второй multicall при наличии NPM NFT (Фаза 5).
4. Цены — из `price_cache`; поход во внешние API только при истекшем TTL.
5. Запись в `balances_cache` / `protocol_positions`; ответ — агрегированное состояние.

Свободные балансы (шаг 2) с Фазы 7 участвуют в расчёте портфеля, а не только пишутся в кэш: контур стоит последним внутри обновления кошелька и падает изолированно — его отказ не уносит уже прочитанные залог, долг и позиции.

### 6.2. Ежедневный cron (`/api/cron/snapshot`, ~03:00 UTC)
1. Zerion-свип discovery по каждому кошельку (≤ 100 вызовов).
2. Полный refresh-пайплайн для всех кошельков, чанками (лимит времени Vercel).
3. Свежие цены (≤ 1 ч — переиспользуются).
4. Запись `snapshots` + `snapshot_items` по каждому пользователю; при отказе сети — последние известные балансы + `is_partial = true`.
5. Идемпотентность: повторный запуск за день перезаписывает снепшот дня.

Масштаб: 50 кошельков × 4 сети ≈ 200–400 `eth_call` + ~4 вызова CoinGecko — секунды работы, глубоко внутри бесплатных тиров.

### 6.3. Мониторинг HF (`/api/cron/health`, каждые 15 минут)
1. Один `getUpdates` к Telegram Bot API — привязка чатов по одноразовым кодам.
2. Пользователи с подтверждённым включённым каналом (остальным читать сеть незачем).
3. По кошельку: `Pool.getUserAccountData` одним контрактом на сеть (без разбивки долга и ставок) → `aave_account_health`.
4. По (кошелёк, сеть): правила `lib/alerts/hf` поверх `hf_alert_state` → максимум одно сообщение.
5. Отправка через реестр каналов; каждая попытка — строка в `notification_log`.

Стоимость мониторинга: 4 `eth_call` на кошелёк за прогон, 96 прогонов в сутки — на порядок дешевле одного refresh, потому что читается одно число вместо десятков балансов.

## 7. Реестр рисков

| Риск | Митигация |
|---|---|
| Публичные RPC флапают/лимитируют | Ключевой провайдер (Alchemy) первым в fallback-цепочке; publicnode/dRPC — резерв |
| Реверт одного вызова портит multicall-батч | `allowFailure: true`; упавший вызов = «неизвестно», не ноль |
| Спам/скам-токены раздувают портфель | Курируемый allowlist как основной источник; скрытие < $1; цену неизвестных токенов не подтягивать автоматически |
| Нет цены CoinGecko у GM/aToken/LP | Структурное ценообразование (§4); поле `source` в кэше |
| Ошибки decimals | bigint + decimals из контракта; formatUnits на границе; тесты на USDC(6)/WBTC(8)/HF(1e18)/GMX(1e30) |
| USDC vs USDC.e | Разные активы (разные contract_address); обе цены есть в CoinGecko; не мержить |
| HF = uint256.max | Отображать «∞»; NULL в БД |
| Vercel: таймаут функций | Оба cron-роута идут последовательно с мягким бюджетом времени и пропуском остатка; слепота дольше 6 ч сама даёт уведомление |
| Исчезновение бесплатного тира Zerion | Discovery-only зависимость: теряется удобство, не функциональность |
| Превышение лимитов API при росте пользователей | Счетчики + алерт при 70%; преапрувленные апгрейды в рамках $50 (§2) |

## 8. Порядок реализации Фазы 1 (для исполнителя)

1. Скаффолд Next.js + Supabase (Auth, схема с RLS, автотест изоляции).
2. CRUD кошельков с валидацией EIP-55.
3. Модуль chain-reader (viem, multicall, allowlist токенов) + `balances_cache`.
4. Модуль цен (CoinGecko-клиент с лимитером + `price_cache`).
5. Корзины, целевые пропорции, движок аллокации/отклонений (чистые функции, юнит-тесты на формулы).
6. Дашборд (таблица, донат, отклонения) + экраны кошельков и настроек целей.
7. Прогон на реальном портфеле, сверка с DeBank/Zerion, замер расхода API.
