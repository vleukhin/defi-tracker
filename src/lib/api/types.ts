/**
 * Типы ответов API для клиентских компонентов.
 * Зеркалят route handlers (src/app/api/*) и движок портфеля
 * (src/lib/portfolio/portfolio.ts) — camelCase, количества строками.
 */

export type PortfolioCategory = "btc" | "eth" | "stable";

/**
 * Почему не посчитались комиссии LP за сутки.
 *
 * Живет здесь, а не рядом с читателем цепочки: значение проходит весь путь
 * от payload до карточки, а этот файл — единственный, который видят и сервер,
 * и клиент (у читателей цепочек стоит server-only). Код, а не готовая фраза:
 * текст в базе заморозил бы формулировку, подписи собираются на экране.
 */
export type Fees24hReason =
  | "no_archive"
  | "too_young"
  | "liquidity_changed"
  | "tick_uninitialized"
  | "implausible";

export interface WalletDto {
  id: string;
  address: string;
  label: string | null;
  lastRefreshedAt: string | null;
  createdAt?: string;
}

export interface CollateralDetailDto {
  walletId: string;
  walletLabel: string | null;
  chain: string;
  symbol: string;
  /** Десятичная строка — не гонять через float. */
  quantity: string;
  priceUsd: number | null;
  valueUsd: number;
  priceStale: boolean;
}

export interface ManualEntryDto {
  id: string;
  label: string;
  amount: string;
  valueUsd: number;
}

/**
 * Блок леджера в строке портфеля (Фаза 2, S2.2). Null-safe: без сделок
 * средняя и unrealized равны null («нет данных о цене покупки»), не нулям.
 */
export interface PortfolioRowLedgerDto {
  /** null — покупок еще не было. */
  avgPriceUsd: number | null;
  /** ledgerQty × (текущая цена − средняя); null без средней или цены. */
  unrealizedPnlUsd: number | null;
  /** (текущая / средняя − 1) × 100; null без средней или цены. */
  unrealizedPnlPct: number | null;
  /** Суммарный realized P/L по продажам (0 — честный ноль без продаж). */
  realizedPnlUsd: number;
  /** Количество по леджеру в единицах категории. */
  ledgerQty: number;
  /**
   * Мягкое предупреждение о расхождении леджера с фактом (залог + ручные,
   * >1%); diff = ledgerQty − actualQty. null — нет сделок / нет факта /
   * расхождение в пределах порога. Никогда не блокирует отображение.
   */
  discrepancy: { ledgerQty: number; actualQty: number; diff: number } | null;
  /** Oversell и прочие аномалии реплея. */
  warnings: string[];
}

export interface PortfolioRowDto {
  category: PortfolioCategory;
  label: string;
  /** Единица количества: BTC, ETH или USD. */
  unit: string;
  /** null = нет цены категории, количество не выводится. */
  amount: number | null;
  amountUsd: number;
  price: number | null;
  priceStale: boolean;
  percent: number;
  targetPercent: number | null;
  percentDiff: number | null;
  /** В единицах категории: минус — продать, плюс — купить. */
  amountToBalance: number | null;
  breakdown: { collateralUsd: number; manualUsd: number };
  collateralDetail: CollateralDetailDto[];
  manualEntries: ManualEntryDto[];
  warnings: string[];
  ledger: PortfolioRowLedgerDto;
}

/**
 * Связка пяти чисел (Фаза 4, S4.2): Активы · Долг · Чистая · Внесено · Прибыль.
 *
 * Методика (утверждена): Чистая = Активы − Долг; Прибыль = Чистая − Внесено.
 * «Внесено» — только собственные деньги, заведенные извне (журнал deposits).
 *
 * Null-семантика честная: если долг ни разу не прочитан (кошельки есть,
 * а строк aave_account_health нет) — debtUsd = null, и netUsd/profitUsd
 * каскадно null. «Нет данных о долге» НИКОГДА не выдается за «долга нет».
 * Без кошельков on-chain долга быть не может — debtUsd = 0.
 */
export interface PortfolioOverviewDto {
  /**
   * Активы = портфель + размещенные позиции (Фаза 5).
   *
   * До Фазы 5 здесь был только итог портфеля, и это занижало Чистую: заемные
   * деньги, ушедшие в пулы и на Fluid, из Активов выпадали, а Долг вычитался
   * целиком. null = стоимость части позиций неизвестна.
   */
  assetsUsd: number | null;
  /** Итог трех категорий — только собственные средства (S5.1: пулы сюда не входят). */
  portfolioUsd: number;
  /** Размещенные позиции с неттингом Fluid; null = оценка части позиций неизвестна. */
  positionsUsd: number | null;
  /** Долг по оракулу Aave (getUserAccountData); null = ни разу не прочитан. */
  debtUsd: number | null;
  netUsd: number | null;
  /** Подписанная сумма журнала deposits (вывод собственных средств — минус). */
  depositedUsd: number;
  profitUsd: number | null;
}

export interface PortfolioDto {
  totalUsd: number;
  overview: PortfolioOverviewDto;
  rows: PortfolioRowDto[];
  targetSumPct: number;
  freshness: {
    oldestPriceAt: string | null;
    oldestCollateralAt: string | null;
    anyPriceStale: boolean;
  };
  chains: { chain: string; ok: boolean; error?: string; checkedAt: string }[];
  wallets: WalletDto[];
}

export interface RefreshResponseDto {
  results: {
    walletId: string;
    debounced: boolean;
    /** null у debounced-кошельков. */
    chains:
      | {
          chain: string;
          ok: boolean;
          error?: string;
          reservesRead: number;
          reservesFailed: number;
        }[]
      | null;
  }[];
  prices: { requested: number; priced: number; stale: number };
  refreshedAt: string;
}

export interface TargetsResponseDto {
  targets: { category: PortfolioCategory; targetPct: number }[];
  sumPct: number;
  warning: string | null;
}

export interface ManualListDto {
  entries: {
    id: string;
    category: PortfolioCategory;
    label: string;
    amount: string;
    createdAt: string;
  }[];
}

export interface WalletsResponseDto {
  wallets: WalletDto[];
}

// --- Фаза 2: журнал сделок ---

export interface TradeDto {
  id: string;
  category: PortfolioCategory;
  side: "buy" | "sell";
  /** Количество в единицах категории, десятичной строкой (точность numeric). */
  quantity: string;
  /** Цена за единицу в USD на момент сделки, строкой. */
  priceUsd: string;
  tradedAt: string;
  note: string | null;
  createdAt: string;
}

/** Итог реплея леджера по категории (GET /api/trades). */
export interface LedgerSummaryDto {
  ledgerQty: number;
  /** null — покупок еще не было. */
  avgPriceUsd: number | null;
  realizedPnlUsd: number;
  warnings: string[];
  /** Число сделок — отличает пустой леджер от «все продано». */
  tradeCount: number;
}

/** Постраничная навигация списка сделок. */
export interface PageInfoDto {
  /** Текущая страница, 1-based. */
  page: number;
  pageSize: number;
  /** Всего сделок, подходящих под фильтр (не всего в леджере). */
  total: number;
  totalPages: number;
}

/**
 * GET /api/trades[?category=&from=&to=&q=&page=&pageSize=]:
 * сделки новыми вперед (traded_at desc), постранично.
 *
 * summary ВСЕГДА по всем сделкам всех трех категорий и не зависит от
 * фильтров и страницы: средняя цена — свойство всего леджера.
 */
export interface TradesResponseDto {
  trades: TradeDto[];
  summary: Record<PortfolioCategory, LedgerSummaryDto>;
  page: PageInfoDto;
}

/** POST /api/trades (201) и PUT /api/trades/{id} (200). */
export interface TradeResponseDto {
  trade: TradeDto;
}

// --- Фаза 3: снепшоты и история ---

/** Состав снепшота: ровно три строки, по одной на категорию. */
/**
 * Сырые количества монет на дату — то, что нельзя восстановить задним числом.
 * Доллары пересчитываются из исторической цены, количество BTC — нет.
 */
export interface SnapshotCompositionDto {
  collateral: { symbol: string; chain: string; quantity: string }[];
  manual: { label: string; amount: string }[];
}

export interface SnapshotItemDto {
  category: PortfolioCategory;
  /**
   * Количество в единицах категории (BTC / ETH / USD).
   * null = цены категории на момент съема не было, эквивалент не выводится.
   */
  quantity: number | null;
  /** Сырой состав: количества монет, не зависящие от наличия цен. */
  composition: SnapshotCompositionDto;
  /** Цена категории на момент съема; null — цены не было. */
  priceUsd: number | null;
  valueUsd: number;
  percent: number;
  /** Разбивка «залог / вручную» (S3.1). */
  collateralUsd: number;
  manualUsd: number;
}

export interface SnapshotDto {
  id: string;
  /** Календарный день UTC, YYYY-MM-DD — ключ идемпотентности. */
  takenOn: string;
  /** Точный момент съема (ISO). */
  takenAt: string;
  totalUsd: number;
  /**
   * Долг Aave на момент съема (Фаза 4): как и composition, задним числом
   * невосстановим. null = долг на момент съема известен не был.
   */
  debtUsd: number | null;
  /**
   * Размещенные позиции (Фаза 5) на момент съема. totalUsd — это ТОЛЬКО
   * портфель; Активы точки = totalUsd + positionsUsd. null = не было известно.
   */
  positionsUsd: number | null;
  /**
   * true = данные заведомо неполные: упало чтение сети либо цена
   * категории/залогового токена отсутствовала или устарела. Такую точку
   * на графике нужно помечать, а не выдавать за настоящую просадку.
   */
  isPartial: boolean;
  items: SnapshotItemDto[];
}

/** Периоды графика истории (S3.2). */
export type SnapshotPeriod = "7d" | "30d" | "90d" | "1y" | "all";

/**
 * GET /api/snapshots[?period=7d|30d|90d|1y|all] — по умолчанию 30d.
 *
 * Порядок: takenOn ПО ВОЗРАСТАНИЮ (график читается слева направо).
 * Пропущенные дни не интерполируются и не добиваются нулями — в ответе
 * только реально снятые точки, разрывы рисует клиент (S3.2).
 */
export interface SnapshotsResponseDto {
  snapshots: SnapshotDto[];
  period: SnapshotPeriod;
  count: number;
}

/** POST /api/snapshots (201) и GET /api/snapshots/{id} (200). */
export interface SnapshotResponseDto {
  snapshot: SnapshotDto;
  /** Только у POST: почему снепшот помечен частичным (пусто — не помечен). */
  partialReasons?: string[];
}

// --- Фаза 4: долг, внесенные средства, health factor ---

/**
 * Запись журнала «Внесено» (S4.0). amount ПОДПИСАННАЯ десятичная строка:
 * положительная — пополнение собственными деньгами, отрицательная — вывод
 * собственных средств. Заемные средства в журнал не попадают никогда.
 */
export interface DepositDto {
  id: string;
  amount: string;
  /** Календарный день, YYYY-MM-DD. */
  happenedOn: string;
  note: string | null;
  createdAt: string;
}

/** GET /api/deposits — записи новыми вперед (happened_on desc). */
export interface DepositsResponseDto {
  deposits: DepositDto[];
  /** Подписанная сумма всего журнала — «Внесено» для связки пяти чисел. */
  summary: { totalDeposited: number };
}

/** POST /api/deposits (201) и PUT /api/deposits/{id} (200). */
export interface DepositResponseDto {
  deposit: DepositDto;
}

/** GET/PUT /api/settings — настройки пользователя (S4.1/S4.3). */
export interface SettingsDto {
  /** Порог предупреждения по health factor; по умолчанию 1.5. */
  hfWarningThreshold: number;
  /**
   * Целевой LTV в процентах (долг / залог), к которому выравнивается плечо;
   * по умолчанию 50 — рабочее значение стратегии. Не порог ликвидации:
   * тот приходит от протокола и не настраивается.
   */
  targetLtvPct: number;
}

// --- Фаза 6: уведомления ---

/**
 * Канал доставки уведомлений о health factor.
 *
 * chat_id наружу не отдаётся: интерфейсу он не нужен, а лишний адрес
 * в ответе — лишний адрес в логах браузера. Вместо него — chatTitle,
 * по которому владелец узнаёт свой чат.
 */
export interface NotificationChannelDto {
  kind: "telegram";
  enabled: boolean;
  /** false = код привязки ещё не отработал, слать некуда. */
  verified: boolean;
  /** «@vasya» или имя чата; null, пока канал не привязан. */
  chatTitle: string | null;
  lastSentAt: string | null;
  /** Последняя ошибка доставки — почему канал молчит. */
  lastError: string | null;
}

/** GET /api/notifications/telegram — состояние канала. */
export interface NotificationStatusDto {
  /** null = канал не заводили. */
  channel: NotificationChannelDto | null;
  /** Имя бота для ссылки t.me; null = переменная окружения не задана. */
  botUsername: string | null;
  /** Действующий код привязки — показывается, пока не истёк. */
  linkCode: string | null;
  linkCodeExpiresAt: string | null;
}

/** Долговая позиция из разбивки по v-токенам (best-effort). */
export interface DebtItemDto {
  symbol: string;
  chain: string;
  /** Количество занятого актива десятичной строкой. */
  quantity: string;
  /** null = coingecko id токена неизвестен или цены нет — показывать количество. */
  valueUsd: number | null;
}

/**
 * Долг по одной сети (S4.3): totals и HF — из оракула Aave
 * (getUserAccountData), разбивка — по v-токенам.
 */
export interface DebtChainDto {
  chain: string;
  totalCollateralUsd: number | null;
  totalDebtUsd: number | null;
  /** null = долга нет («∞») либо HF неизвестен. */
  healthFactor: number | null;
  /** totalDebtUsd / totalCollateralUsd; null без данных или без залога. */
  utilization: number | null;
  items: DebtItemDto[];
  /** Момент последнего успешного чтения getUserAccountData. */
  checkedAt: string;
}

export interface DebtSummaryDto {
  /** null = кошельки есть, а долг ни разу не прочитан («нет данных» ≠ 0). */
  totalDebtUsd: number | null;
  /**
   * Минимальный HF среди сетей С ДОЛГОМ — связывающее ограничение:
   * ликвидация приходит на ту сеть, где HF ниже. null = долга нет нигде.
   */
  minHealthFactor: number | null;
  hfWarningThreshold: number;
  /** true = minHealthFactor ниже порога — заметное предупреждение (S4.3). */
  belowThreshold: boolean;
}

/**
 * GET /api/debt — только кэш (aave_account_health + protocol_positions +
 * coin_prices), без RPC. Пустое состояние (долга нет нигде) — это
 * chains с нулевым долгом и totalDebtUsd 0, а не ошибка.
 */
export interface DebtResponseDto {
  chains: DebtChainDto[];
  summary: DebtSummaryDto;
}

// --- Фаза 5: размещение заемных средств ---

export type PositionProtocol = "fluid" | "gmx_v2" | "uni_v3";

/**
 * Зоны стратегии Capital Growth (docs/07-strategia-capital-growth.md).
 *
 * НЕ то же самое, что три категории портфеля: категория отвечает «в чем
 * лежит» (BTC / ETH / стейблы), зона — «какую задачу решает». Стейблкоины
 * есть и в Stability, и в Yield, поэтому одно через другое не выражается.
 */
export type StrategyZone = "growth" | "yield" | "stability";

/** Составляющая позиции: во что она разложена (S5.1/S5.2). */
export interface PositionComponentDto {
  symbol: string;
  quantity: number;
  /** null = цены компонента нет — показываем количество, не ноль. */
  valueUsd: number | null;
  /** «long» / «short» для GM, иначе null. */
  side: "long" | "short" | null;
}

/**
 * Размещенная позиция. В три категории портфеля НЕ входит (решение S5.1):
 * портфель ведется по собственным средствам, а здесь лежат преимущественно
 * заемные. В «Активы» пяти чисел входит — иначе Чистая занижена.
 */
export interface PositionDto {
  /** protocol_positions.id — им же оперируют связки «займ → позиция». */
  id: string;
  protocol: PositionProtocol;
  protocolLabel: string;
  chain: string;
  /** Зона стратегии; по умолчанию Yield, размечается пользователем (Фаза 6). */
  zone: StrategyZone;
  /** Натуральный ключ разметки: переживает пересоздание строки читателем. */
  zoneKey: string;
  /**
   * Сколько СОБСТВЕННЫХ средств вложено в позицию (не текущая доля).
   * null = не размечено; такая позиция идет в расчет как целиком заемная,
   * но помечается — после перезаливки диапазона CLMM разметка не переносится.
   */
  ownPrincipalUsd: number | null;
  /** Сколько ЗАЕМНЫХ средств вложено. null = не размечено. */
  borrowedPrincipalUsd: number | null;
  /**
   * Сколько выведено из позиции по стоимости на момент вывода. Продажа части
   * GM с переводом BTC/ETH в залог — это не убыток, а переезд капитала.
   * null трактуется как ноль: отсутствие выводов — обычное состояние.
   */
  withdrawnUsd: number | null;
  /**
   * Текущая собственная доля стоимости позиции: доход и убыток относятся
   * на свое и заемное пропорционально вложенному. Из этих величин
   * складывается категория «Стейблы».
   */
  ownCurrentUsd: number | null;
  /**
   * Доход позиции = стоимость + выведено − вложено. null, пока вложенное
   * размечено не полностью: остаток мог бы оказаться и заемной частью,
   * и начисленными процентами.
   */
  profitUsd: number | null;
  profitPct: number | null;
  /** «fUSDC», «GM ETH/USD», «WETH/USDC 0,05%». */
  title: string;
  subtitle: string | null;
  /** Количество в единицах позиции; у LP это ликвидность, поэтому строкой. */
  quantity: string | null;
  /** null = оценка неизвестна (не ноль). */
  valueUsd: number | null;
  components: PositionComponentDto[];
  /** Несобранные комиссии LP в долларах; null — неизвестны или неприменимо. */
  feesUsd: number | null;
  /**
   * Комиссии, начисленные пулу за последние сутки, в долларах.
   *
   * В отличие от feesUsd это поток, а не остаток: сбор комиссий внутри окна
   * на него не влияет. Ноль — содержательный ответ (позиция простояла сутки
   * вне диапазона), а null означает «не посчитано», и почему именно —
   * в fees24hReason. Неприменимо ко всему, кроме LP.
   */
  fees24hUsd: number | null;
  /** Почему комиссии за сутки неизвестны; null = известны или неприменимо. */
  fees24hReason: Fees24hReason | null;
  /** false = LP вне диапазона (позиция целиком в одном активе); null — неприменимо. */
  inRange: boolean | null;
  /**
   * С какого момента позиция замечена вне диапазона (ISO); null = в диапазоне
   * или неприменимо. От него считается правило 48 часов (docs/07 §5–§7):
   * сам факт выхода читается заново, а момент перехода невосстановим.
   */
  outOfRangeSince: string | null;
  /** Ценовой диапазон CLMM-позиции; null — у позиции диапазона нет. */
  range: PositionRangeDto | null;
  /**
   * Базовая ставка позиции на момент чтения, % годовых (APR). Есть у
   * депозитов лендингов (Fluid); у пулов ставки нет — доход там считается
   * по стоимости, а не начисляется процентом. null = неизвестна.
   */
  supplyRatePercent: number | null;
  /** Награды сверх базовой ставки, % годовых (APR); null = неизвестны. */
  rewardsRatePercent: number | null;
  walletId: string;
  walletLabel: string | null;
  /** Момент чтения: стоимость позиции — на ЭТУ дату, не на момент показа. */
  updatedAt: string;
}

/**
 * Ценовой диапазон CLMM-позиции в человеческих единицах.
 *
 * Пара всегда показывается как «сколько котировки за базовый актив», и
 * котировкой выбирается стейбл: порядок token0/token1 в пуле задан
 * адресами, и без этого половина диапазонов читалась бы наизнанку.
 */
export interface PositionRangeDto {
  /** Базовый актив пары — тот, чья цена показывается. */
  baseSymbol: string;
  /** В чем измеряется цена. */
  quoteSymbol: string;
  /** Нижняя граница; null = позиция открыта на весь диапазон. */
  lowerPrice: number | null;
  /** Верхняя граница; null = позиция открыта на весь диапазон. */
  upperPrice: number | null;
  /** Цена пула на момент чтения; null = тик не прочитан. */
  currentPrice: number | null;
  /**
   * Положение цены в диапазоне: 0 — нижняя граница, 1 — верхняя.
   * Меньше нуля или больше единицы = вне диапазона, и знак говорит,
   * в какую сторону. null = цена не прочитана.
   */
  position: number | null;
  /**
   * На сколько процентов цена ушла за ближайшую границу; знак = сторона.
   * null = позиция в диапазоне или цена не прочитана.
   */
  outsidePercent: number | null;
  /**
   * Во что превратится позиция при выходе за нижнюю границу: у нижней цены
   * она целиком в базовом активе, у верхней — целиком в котировке. Это и
   * есть развилка стратегии (docs/07 §5, §6): вниз — актив уходит в Growth,
   * вверх — стейблы переоткрывают диапазон. null = граница без числа
   * (позиция на весь диапазон) или ликвидность не прочитана.
   */
  exitLower: PositionExitDto | null;
  exitUpper: PositionExitDto | null;
}

/** Актив, в котором окажется позиция при выходе за границу. */
export interface PositionExitDto {
  symbol: string;
  quantity: number;
}

/**
 * Сколько стоят заемные стейблы на Aave — порог для ставок Yield-позиций.
 *
 * По стратегии (docs/07 §3) депозит на стороннем лендинге держат, только
 * пока его ставка выше ставки по займу. Сравнивать поэтому надо не с нулем,
 * а с этим числом, и оно должно быть в приложении, а не в голове.
 */
export interface StableBorrowRateDto {
  /**
   * Средневзвешенная по размеру долга ставка variable-займа, % годовых (APR).
   * null = ставки не прочитаны ни по одному стейбл-резерву.
   */
  ratePercent: number | null;
  /** Долг в стейблах, из которого считалась ставка. */
  debtUsd: number;
  /** Из чего сложилось: по сети и резерву. */
  reserves: {
    chain: string;
    symbol: string;
    debtUsd: number;
    ratePercent: number | null;
  }[];
}

/**
 * Вклад позиций в «Активы» и учет собственного капитала внутри них.
 *
 * Фаза 5 вычитала собственные стейблы только из депозита Fluid. Это оказалось
 * неверно, как только свои деньги переехали с Fluid в CLMM-позицию: своя часть
 * попадала в Активы дважды. Теперь вычитается явно объявленная величина —
 * журнал размещений, — и от протокола она не зависит.
 */
export interface PositionsSummaryDto {
  /** Вклад позиций в «Активы»: стоимость позиций МИНУС свои внутри них. */
  positionsUsd: number | null;
  /** Стоимость всех позиций как есть, до вычета своих средств. */
  grossUsd: number | null;
  /** Сумма текущих собственных долей (неразмеченные считаются нулем). */
  ownUsd: number;
  /** Суммарный доход размеченных позиций; null, если размечены не все. */
  profitUsd: number | null;
  /** Сколько позиций осталось без оценки — из-за них positionsUsd может быть null. */
  unpricedCount: number;
  /** Позиции без разметки собственной доли — их видно в интерфейсе. */
  unmarkedCount: number;
}

/**
 * GET /api/leverage — размещение заёмных средств, только кэш, без RPC.
 *
 * Привязки «займ → позиция» здесь больше нет: заём уходит в разные позиции
 * по частям, и отношение «один заём — одна позиция» этого не описывает.
 * Сам долг отдаёт /api/debt.
 */
export interface LeverageResponseDto {
  positions: PositionDto[];
  summary: PositionsSummaryDto;
  chains: { chain: string; source: string; ok: boolean; error?: string }[];
}

// --- Фаза 6: зоны стратегии и собственный капитал в позициях ---

/** Одна зона: из чего сложилась и сколько стоит. */
export interface ZoneBreakdownDto {
  zone: StrategyZone;
  label: string;
  /** Задача зоны по стратегии — подпись под заголовком. */
  purpose: string;
  /** Залог BTC/ETH — всегда Growth. */
  collateralUsd: number;
  /** Ручные записи, отнесенные к зоне. */
  manualUsd: number;
  /** Читаемые позиции зоны; null = стоимость части неизвестна. */
  positionsUsd: number | null;
  /** collateral + manual + positions; null при неизвестных позициях. */
  valueUsd: number | null;
  /** Доля от суммы зон; null пока знаменатель неизвестен. */
  percent: number | null;
  positionCount: number;
}

/**
 * GET /api/zones — разрез портфеля по зонам стратегии.
 *
 * Инвариант: сумма зон равна «Активам» из связки пяти чисел.
 * Вычитать здесь ничего не нужно — позиции входят целиком, а собственные
 * стейблы внутри них в зонах отдельной строкой не появляются.
 */
export interface ZonesSummaryDto {
  zones: ZoneBreakdownDto[];
  totalUsd: number | null;
  /** Сумма собственных долей по позициям — для сверки с категорией «Стейблы». */
  ownInPositionsUsd: number;
  unpricedPositions: number;
  /** Позиции без разметки собственной доли. */
  unmarkedPositions: number;
}
