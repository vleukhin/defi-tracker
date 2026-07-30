# ТЗ. Часть 4: Техническая архитектура

**Версия:** 1.0 (30.07.2026). Тарифы и лимиты внешних сервисов проверены на 29.07.2026.

---

## 1. Стек (рекомендованный)

| Слой | Выбор | Обоснование |
|---|---|---|
| Приложение | **Next.js (App Router), TypeScript** | Один деплой для UI + API-роутов; SSR для быстрого дашборда |
| Хостинг | **Vercel Hobby** ($0) | Cron поддерживается (1 запуск/день — достаточно для снепшота); некоммерческое использование соответствует условиям Hobby |
| БД + Auth | **Supabase Free** ($0) | Postgres 500 МБ (годы снепшотов для 20 пользователей), Supabase Auth (email+пароль, верификация), **Row Level Security** — изоляция пользователей на уровне БД |
| Блокчейн | **viem** | Типизированный клиент, встроенный multicall-батчинг, ranked fallback-транспорты |
| Джобы | **Vercel Cron** → `/api/cron/snapshot` (защита `CRON_SECRET`) | При нехватке кадансности — бесплатный внешний триггер (GitHub Actions schedule / cron-job.org) на тот же роут |

**Альтернатива** (если серверлесс-таймауты станут мешать): Node/Fastify + React SPA на VPS Hetzner (~€4–5/мес) или Railway ($5/мес), Postgres на той же машине, Auth.js/Lucia, node-cron. Снимает лимиты времени выполнения ценой ops.

Известные ограничения Vercel Hobby: cron максимум 1 раз/день с джиттером до 59 мин внутри часа; таймаут функций — снепшот-роут обрабатывает кошельки чанками, чтобы ни одна инвокация не упиралась в лимит. При переходе к коммерческому использованию — Vercel Pro $20/мес.

## 2. Внешние сервисы и бюджет

| Сервис | Тариф | Оценка расхода | $/мес |
|---|---|---|---|
| Alchemy (RPC, 4 сети) | Free: 30M CU/мес, 25 RPS | < 2M CU | $0 |
| dRPC / publicnode | Публичные fallback-RPC | только фолбэк | $0 |
| Zerion API (discovery) | Free Developer: 2 000 req/день, 3 RPS | ~50–100 req/день | $0 |
| CoinGecko | Demo: 10 000 вызовов/мес, ~30/мин (закладываться на 30, не на заявленные 100) | ~3 000 вызовов/мес | $0 |
| GMX prices API (gmxinfra.io) | Публичный | ~50 вызовов/день | $0 |
| Vercel | Hobby | 1 проект, дневной cron | $0 |
| Supabase | Free | < 100 МБ | $0 |
| **Итого** | | | **$0** (бюджет $50 — запас) |

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

### 3.4. GMX v2 (Фаза 5, Arbitrum)
- GM-балансы — обычные ERC-20 (multicall).
- Цена GM-токена: REST `https://arbitrum-api.gmxinfra.io/prices/tickers` и `/markets/info` (подписанные оракульные цены, бесплатно). Ончейн-альтернатива — Reader `getMarketTokenPrice(...)`, требует оракульные цены на вход. Цены GMX — фикс-поинт **1e30**.
- Декомпозиция на long/short-компоненты — по весам пула из `/markets/info`.

### 3.5. Uniswap v3 (Фаза 5)
- Перечисление позиций: `NonfungiblePositionManager.balanceOf` + `tokenOfOwnerByIndex` + `positions(tokenId)`. Адрес NPM на Base отличается от остальных сетей — адреса задаются per-chain конфигом.
- Количества токенов из `slot0().sqrtPriceX96` + tick math (`@uniswap/v3-sdk`); несобранные комиссии — static call `collect`.

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
                    price_usd, fee_usd?, traded_at, note -- Фаза 2, реплей для средней
target_allocations  id, user_id, bucket_id, target_pct
protocol_positions  id, wallet_id, protocol ('aave_v3'|'gmx_v2'|'uni_v3'), chain,
                    external_id (NPM tokenId / market addr), payload jsonb (HF, ticks...),
                    quantity, value_usd, updated_at      -- upsert текущего состояния
borrow_links        id, user_id, borrow_ref, position_ref                    -- Фаза 5
price_cache         asset_id, price_usd, source, fetched_at
snapshots           id, user_id, taken_at, gross_usd, debt_usd, net_usd, is_partial, payload jsonb
snapshot_items      snapshot_id FK, asset_id, wallet_id?, quantity, price_usd, value_usd, protocol?
balances_cache      wallet_id, asset_id, raw_amount numeric, updated_at      -- последнее известное состояние
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

### 6.2. Ежедневный cron (`/api/cron/snapshot`, ~03:00 UTC)
1. Zerion-свип discovery по каждому кошельку (≤ 100 вызовов).
2. Полный refresh-пайплайн для всех кошельков, чанками (лимит времени Vercel).
3. Свежие цены (≤ 1 ч — переиспользуются).
4. Запись `snapshots` + `snapshot_items` по каждому пользователю; при отказе сети — последние известные балансы + `is_partial = true`.
5. Идемпотентность: повторный запуск за день перезаписывает снепшот дня.

Масштаб: 50 кошельков × 4 сети ≈ 200–400 `eth_call` + ~4 вызова CoinGecko — секунды работы, глубоко внутри бесплатных тиров.

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
| Vercel Hobby: cron 1/день, джиттер, таймауты | Достаточно для дневного снепшота; чанкование; внешний бесплатный триггер при необходимости |
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
