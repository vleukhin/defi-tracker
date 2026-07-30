/**
 * Типы ответов API для клиентских компонентов.
 * Зеркалят route handlers (src/app/api/*) и движок портфеля
 * (src/lib/portfolio/portfolio.ts) — camelCase, количества строками.
 */

export type PortfolioCategory = "btc" | "eth" | "stable";

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
  /** Активы = итог портфеля (оценка CoinGecko). */
  assetsUsd: number;
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
