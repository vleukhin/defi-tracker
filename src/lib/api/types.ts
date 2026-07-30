/**
 * Типы ответов API для клиентских компонентов.
 * Зеркалят route handlers (src/app/api/*) и движок аллокации
 * (src/lib/portfolio/allocation.ts) — camelCase, количества строками.
 */

export interface WalletDto {
  id: string;
  address: string;
  label: string | null;
  lastRefreshedAt: string | null;
  createdAt?: string;
}

export interface SourceDto {
  walletId: string;
  walletLabel: string | null;
  chain: string;
  /** Десятичная строка — не гонять через float. */
  quantity: string;
  valueUsd: number | null;
}

export interface AssetRowDto {
  key: string;
  symbol: string;
  /** Десятичная строка — не гонять через float. */
  quantity: string;
  priceUsd: number | null;
  valueUsd: number | null;
  priceStale: boolean;
  assetIds: string[];
  sources: SourceDto[];
}

export interface BucketAllocationDto {
  bucketId: string;
  name: string;
  builtin: boolean;
  valueUsd: number;
  currentPct: number;
  targetPct: number | null;
  /** currentPct − targetPct; null — цель не задана. */
  deviationPp: number | null;
  /** >0 — «Купить $X», <0 — «Продать $X». */
  rebalanceUsd: number | null;
  assets: AssetRowDto[];
}

export interface PortfolioDto {
  totalUsd: number;
  buckets: BucketAllocationDto[];
  unrecognized: AssetRowDto[];
  hidden: AssetRowDto[];
  maxDeviation: {
    bucketId: string;
    name: string;
    deviationPp: number;
    /** + — сверх цели, − — ниже цели, $. */
    amountUsd: number;
  } | null;
  targetSumPct: number;
  freshness: {
    oldestBalanceAt: string | null;
    oldestPriceAt: string | null;
  };
  wallets: WalletDto[];
}

export interface RefreshChainStatus {
  chain: string;
  ok: boolean;
  error?: string;
  tokensRead: number;
  tokensFailed: number;
}

export interface RefreshResponseDto {
  results: {
    walletId: string;
    debounced: boolean;
    /** null у debounced-кошельков. */
    chains: RefreshChainStatus[] | null;
  }[];
  prices: { requested: number; priced: number; stale: number };
  refreshedAt: string;
}

export interface BucketDto {
  id: string;
  name: string;
  builtin: boolean;
}

export interface TargetDto {
  bucketId: string;
  targetPct: number;
}

export interface TargetsResponseDto {
  targets: TargetDto[];
  sumPct: number;
  warning: string | null;
}
