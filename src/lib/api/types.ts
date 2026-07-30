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

export interface PortfolioDto {
  totalUsd: number;
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

/**
 * GET /api/trades[?category=]: сделки новыми вперед (traded_at desc);
 * summary всегда по всем трем категориям, фильтр сужает только список.
 */
export interface TradesResponseDto {
  trades: TradeDto[];
  summary: Record<PortfolioCategory, LedgerSummaryDto>;
}

/** POST /api/trades (201) и PUT /api/trades/{id} (200). */
export interface TradeResponseDto {
  trade: TradeDto;
}
