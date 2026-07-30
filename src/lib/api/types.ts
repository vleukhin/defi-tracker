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
