import { formatUnits } from "viem";
import { BUILTIN_BUCKET_IDS } from "@/lib/chains/allowlist";

/**
 * Движок аллокации (ТЗ S1.5–S1.7). ЧИСТЫЕ функции, без I/O:
 * агрегация холдингов (актив x кошелек x сеть -> строка актива),
 * корзины с учетом пользовательских override, отклонения и суммы
 * ребалансировки. Сырые количества — bigint до самого края;
 * formatUnits -> десятичная строка только на выходе.
 *
 * Формулы (ТЗ S1.7):
 *   отклонение (п.п.) = текущий % - целевой %
 *   сумма ребалансировки = целевой % x стоимость портфеля - стоимость корзины
 */

export const OTHER_BUCKET_ID = BUILTIN_BUCKET_IDS.OTHER;
/** Порог пыли по умолчанию (S1.4): стоимость < $1 -> скрыто. */
export const DEFAULT_DUST_THRESHOLD_USD = 1;

export interface HoldingInput {
  walletId: string;
  walletLabel: string | null;
  chain: string;
  assetId: string;
  symbol: string;
  decimals: number;
  /** Сырое значение из контракта. */
  raw: bigint;
  coingeckoId: string | null;
  /** ISO-время последнего чтения баланса. */
  balanceUpdatedAt: string;
}

export interface PriceEntry {
  priceUsd: number;
  fetchedAt: string;
  stale?: boolean;
}

export interface BucketInfo {
  id: string;
  name: string;
  builtin: boolean;
}

export interface BucketMapEntry {
  assetId: string;
  bucketId: string;
  /** null = встроенный дефолт; иначе пользовательский override. */
  userId: string | null;
}

export interface TargetEntry {
  bucketId: string;
  targetPct: number;
}

export interface SourceRow {
  walletId: string;
  walletLabel: string | null;
  chain: string;
  quantity: string;
  valueUsd: number | null;
}

export interface AssetRow {
  /** Ключ отождествления: coingecko id либо `sym:<symbol>`. */
  key: string;
  symbol: string;
  /** Суммарное количество, десятичная строка. */
  quantity: string;
  priceUsd: number | null;
  valueUsd: number | null;
  /** true = цена из кэша старше TTL. */
  priceStale: boolean;
  assetIds: string[];
  /** Раскрываемая разбивка: кошелек x сеть (S1.5). */
  sources: SourceRow[];
}

export interface BucketAllocation {
  bucketId: string;
  name: string;
  builtin: boolean;
  valueUsd: number;
  currentPct: number;
  targetPct: number | null;
  deviationPp: number | null;
  rebalanceUsd: number | null;
  assets: AssetRow[];
}

export interface AllocationResult {
  totalUsd: number;
  buckets: BucketAllocation[];
  /** Активы без цены — исключены из итогов и аллокации (S1.4). */
  unrecognized: AssetRow[];
  /** Активы с ценой, но стоимостью < порога пыли — скрыты по умолчанию. */
  hidden: AssetRow[];
  maxDeviation: {
    bucketId: string;
    name: string;
    deviationPp: number;
    /** Стоимость сверх (+) / ниже (-) цели, $. */
    amountUsd: number;
  } | null;
  targetSumPct: number;
  freshness: {
    oldestBalanceAt: string | null;
    oldestPriceAt: string | null;
  };
}

export interface AllocationInput {
  holdings: HoldingInput[];
  /** Цены по asset_id. */
  prices: ReadonlyMap<string, PriceEntry>;
  buckets: BucketInfo[];
  /** Дефолтный маппинг + пользовательские override. */
  bucketMap: BucketMapEntry[];
  targets: TargetEntry[];
  dustThresholdUsd?: number;
}

/** Эффективная корзина актива: override пользователя > дефолт > «Прочее». */
export function resolveBucketMap(
  bucketMap: BucketMapEntry[],
): Map<string, string> {
  const effective = new Map<string, string>();
  for (const entry of bucketMap) {
    if (entry.userId === null && !effective.has(entry.assetId)) {
      effective.set(entry.assetId, entry.bucketId);
    }
  }
  for (const entry of bucketMap) {
    if (entry.userId !== null) {
      effective.set(entry.assetId, entry.bucketId);
    }
  }
  return effective;
}

/** Валидация целей: предупреждает (не блокирует), если сумма != 100 (S1.6). */
export function validateTargets(targets: TargetEntry[]): {
  sumPct: number;
  warning: string | null;
} {
  const sumPct = round2(targets.reduce((s, t) => s + t.targetPct, 0));
  const warning =
    targets.length > 0 && Math.abs(sumPct - 100) > 0.001
      ? `Сумма целевых процентов ${sumPct}% (не 100%)`
      : null;
  return { sumPct, warning };
}

interface MergeGroup {
  key: string;
  symbol: string;
  bucketId: string;
  assetIds: Set<string>;
  /** Суммирование bigint с нормализацией к максимальным decimals группы. */
  sumScaled: bigint;
  maxDecimals: number;
  valueUsd: number;
  hasPrice: boolean;
  priceUsd: number | null;
  priceStale: boolean;
  sources: SourceRow[];
}

export function computeAllocation(input: AllocationInput): AllocationResult {
  const dust = input.dustThresholdUsd ?? DEFAULT_DUST_THRESHOLD_USD;
  const effectiveBucket = resolveBucketMap(input.bucketMap);
  const bucketInfo = new Map(input.buckets.map((b) => [b.id, b]));

  let oldestBalanceMs: number | null = null;
  let oldestPriceMs: number | null = null;

  // --- 1. Слияние холдингов: (корзина, ключ отождествления) -> группа ---
  const groups = new Map<string, MergeGroup>();

  for (const h of input.holdings) {
    if (h.raw === 0n) continue;

    oldestBalanceMs = older(oldestBalanceMs, Date.parse(h.balanceUpdatedAt));

    const price = input.prices.get(h.assetId);
    const mergeKey = h.coingeckoId ?? `sym:${h.symbol.toLowerCase()}`;
    const bucketId = effectiveBucket.get(h.assetId) ?? OTHER_BUCKET_ID;
    const groupKey = `${bucketId}|${mergeKey}`;

    let group = groups.get(groupKey);
    if (!group) {
      group = {
        key: mergeKey,
        symbol: h.symbol,
        bucketId,
        assetIds: new Set(),
        sumScaled: 0n,
        maxDecimals: h.decimals,
        valueUsd: 0,
        hasPrice: false,
        priceUsd: null,
        priceStale: false,
        sources: [],
      };
      groups.set(groupKey, group);
    }

    // Нормализация bigint к общим decimals (без потерь, без float)
    if (h.decimals > group.maxDecimals) {
      group.sumScaled *= 10n ** BigInt(h.decimals - group.maxDecimals);
      group.maxDecimals = h.decimals;
    }
    const scaledRaw = h.raw * 10n ** BigInt(group.maxDecimals - h.decimals);
    group.sumScaled += scaledRaw;
    group.assetIds.add(h.assetId);

    // formatUnits только на границе агрегации (десятичная строка)
    const quantityStr = formatUnits(h.raw, h.decimals);
    let valueUsd: number | null = null;
    if (price) {
      valueUsd = Number(quantityStr) * price.priceUsd;
      group.valueUsd += valueUsd;
      group.hasPrice = true;
      group.priceUsd = price.priceUsd;
      if (price.stale) group.priceStale = true;
      oldestPriceMs = older(oldestPriceMs, Date.parse(price.fetchedAt));
    }

    group.sources.push({
      walletId: h.walletId,
      walletLabel: h.walletLabel,
      chain: h.chain,
      quantity: quantityStr,
      valueUsd,
    });
  }

  // --- 2. Категоризация: нераспознанные / скрытые / в корзины ---
  const unrecognized: AssetRow[] = [];
  const hidden: AssetRow[] = [];
  const byBucket = new Map<string, AssetRow[]>();

  for (const g of groups.values()) {
    const row = toAssetRow(g);
    if (!g.hasPrice) {
      unrecognized.push(row);
    } else if (g.valueUsd < dust) {
      hidden.push(row);
    } else {
      const list = byBucket.get(g.bucketId) ?? [];
      list.push(row);
      byBucket.set(g.bucketId, list);
    }
  }

  // --- 3. Корзины: стоимость, %, цель, отклонение, ребалансировка ---
  const targetByBucket = new Map(input.targets.map((t) => [t.bucketId, t.targetPct]));
  let totalUsd = 0;
  for (const rows of byBucket.values()) {
    for (const r of rows) totalUsd += r.valueUsd ?? 0;
  }

  const bucketIds = new Set<string>([...byBucket.keys(), ...targetByBucket.keys()]);
  const buckets: BucketAllocation[] = [];

  for (const bucketId of bucketIds) {
    const info = bucketInfo.get(bucketId);
    const assets = (byBucket.get(bucketId) ?? []).sort(
      (a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0),
    );
    const valueUsd = assets.reduce((s, a) => s + (a.valueUsd ?? 0), 0);
    const currentPct = totalUsd > 0 ? (valueUsd / totalUsd) * 100 : 0;
    const targetPct = targetByBucket.get(bucketId) ?? null;

    buckets.push({
      bucketId,
      name: info?.name ?? "?",
      builtin: info?.builtin ?? false,
      valueUsd: round2(valueUsd),
      currentPct: round2(currentPct),
      targetPct,
      deviationPp: targetPct === null ? null : round2(currentPct - targetPct),
      rebalanceUsd:
        targetPct === null ? null : round2((targetPct / 100) * totalUsd - valueUsd),
      assets,
    });
  }

  buckets.sort((a, b) => b.valueUsd - a.valueUsd);

  // --- 4. Максимальное отклонение (S1.7) ---
  let maxDeviation: AllocationResult["maxDeviation"] = null;
  for (const b of buckets) {
    if (b.deviationPp === null) continue;
    if (!maxDeviation || Math.abs(b.deviationPp) > Math.abs(maxDeviation.deviationPp)) {
      maxDeviation = {
        bucketId: b.bucketId,
        name: b.name,
        deviationPp: b.deviationPp,
        // «$N сверх цели»: положительно при перевесе
        amountUsd: round2(-(b.rebalanceUsd ?? 0)),
      };
    }
  }

  return {
    totalUsd: round2(totalUsd),
    buckets,
    unrecognized: unrecognized.sort((a, b) => a.symbol.localeCompare(b.symbol)),
    hidden: hidden.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)),
    maxDeviation,
    targetSumPct: validateTargets(input.targets).sumPct,
    freshness: {
      oldestBalanceAt: oldestBalanceMs === null ? null : new Date(oldestBalanceMs).toISOString(),
      oldestPriceAt: oldestPriceMs === null ? null : new Date(oldestPriceMs).toISOString(),
    },
  };
}

function toAssetRow(g: MergeGroup): AssetRow {
  return {
    key: g.key,
    symbol: g.symbol,
    quantity: formatUnits(g.sumScaled, g.maxDecimals),
    priceUsd: g.priceUsd,
    valueUsd: g.hasPrice ? round2(g.valueUsd) : null,
    priceStale: g.priceStale,
    assetIds: [...g.assetIds].sort(),
    sources: g.sources.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)),
  };
}

const older = (current: number | null, candidate: number): number | null => {
  if (Number.isNaN(candidate)) return current;
  return current === null ? candidate : Math.min(current, candidate);
};

const round2 = (n: number): number => Math.round(n * 100) / 100;
