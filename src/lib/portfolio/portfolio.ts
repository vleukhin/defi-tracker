/**
 * Движок портфеля: три фиксированные категории (ТЗ 02 §2а).
 *
 * Чистые функции без I/O — вся работа с БД и прайсером снаружи.
 *
 * Ключевое правило оценки: каждый залоговый актив оценивается ПО СВОЕЙ цене
 * (1 wstETH ≈ 1.24 ETH), а отображаемое количество категории выводится как
 * стоимость / цена категории, то есть в BTC- или ETH-эквиваленте. Считать
 * wstETH за 1 ETH завысило бы количество ETH почти на четверть.
 *
 * Долг здесь не участвует вообще: учет портфеля независим от заемных средств.
 */

export const PORTFOLIO_CATEGORIES = ["btc", "eth", "stable"] as const;
export type PortfolioCategory = (typeof PORTFOLIO_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<PortfolioCategory, string> = {
  btc: "BTC",
  eth: "ETH",
  stable: "Stablecoins",
};

/** Единица измерения количества категории — для подписи в UI. */
export const CATEGORY_UNITS: Record<PortfolioCategory, string> = {
  btc: "BTC",
  eth: "ETH",
  stable: "USD",
};

export interface CollateralInput {
  walletId: string;
  walletLabel: string | null;
  chain: string;
  symbol: string;
  category: "btc" | "eth";
  coingeckoId: string;
  /** Количество базового токена десятичной строкой (из formatUnits). */
  quantity: string;
}

export interface ManualInput {
  id: string;
  category: PortfolioCategory;
  label: string;
  /** Монеты для btc/eth, доллары для stable. */
  amount: string;
}

export interface PriceInput {
  priceUsd: number;
  fetchedAt: string;
  stale: boolean;
}

export interface ComputeInput {
  collateral: CollateralInput[];
  manual: ManualInput[];
  /** Цель в процентах по категории; отсутствие ключа = цель не задана. */
  targets: Partial<Record<PortfolioCategory, number>>;
  /** Цены по coingecko id (категорий и залоговых токенов). */
  prices: Map<string, PriceInput>;
  /** Цена стейблкоина; по умолчанию 1.00. */
  stablePriceUsd?: number;
  /** coingecko id категорий; по умолчанию bitcoin / ethereum. */
  categoryIds?: { btc: string; eth: string };
}

export interface CollateralDetail {
  walletId: string;
  walletLabel: string | null;
  chain: string;
  symbol: string;
  quantity: string;
  priceUsd: number | null;
  valueUsd: number;
  priceStale: boolean;
}

export interface ManualDetail {
  id: string;
  label: string;
  amount: string;
  valueUsd: number;
}

export interface PortfolioRow {
  category: PortfolioCategory;
  label: string;
  unit: string;
  /** Количество в единицах категории (BTC/ETH-эквивалент, USD для стейблов). */
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
  collateralDetail: CollateralDetail[];
  manualEntries: ManualDetail[];
  /** Проблемы, которые нужно показать пользователю (не молчать). */
  warnings: string[];
}

export interface PortfolioResult {
  totalUsd: number;
  rows: PortfolioRow[];
  targetSumPct: number;
  /** Самая старая цена среди использованных — для метки свежести. */
  oldestPriceAt: string | null;
  anyPriceStale: boolean;
}

const DEFAULT_CATEGORY_IDS = { btc: "bitcoin", eth: "ethereum" } as const;

/** Безопасный парсинг десятичной строки: мусор трактуется как 0, не как NaN. */
function toNumber(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export function computePortfolio(input: ComputeInput): PortfolioResult {
  const stablePrice = input.stablePriceUsd ?? 1;
  const categoryIds = input.categoryIds ?? DEFAULT_CATEGORY_IDS;
  const usedPriceAt: string[] = [];
  let anyPriceStale = false;

  /** Цена категории: стейблы фиксированы, BTC/ETH — из прайсера. */
  function categoryPrice(category: PortfolioCategory): PriceInput | null {
    if (category === "stable") {
      return { priceUsd: stablePrice, fetchedAt: "", stale: false };
    }
    return input.prices.get(categoryIds[category]) ?? null;
  }

  const rows: PortfolioRow[] = PORTFOLIO_CATEGORIES.map((category) => {
    const warnings: string[] = [];
    const price = categoryPrice(category);
    if (price && price.fetchedAt) {
      usedPriceAt.push(price.fetchedAt);
      if (price.stale) anyPriceStale = true;
    }

    // --- Залог: каждый актив по своей цене ---
    const collateralDetail: CollateralDetail[] = [];
    let collateralUsd = 0;
    for (const c of input.collateral) {
      if (c.category !== category) continue;
      const assetPrice = input.prices.get(c.coingeckoId) ?? null;
      const quantity = toNumber(c.quantity);
      const valueUsd = assetPrice ? quantity * assetPrice.priceUsd : 0;
      if (assetPrice) {
        usedPriceAt.push(assetPrice.fetchedAt);
        if (assetPrice.stale) anyPriceStale = true;
      } else {
        // Нет цены — молча в ноль не превращаем, а сообщаем
        warnings.push(`нет цены для ${c.symbol} (${c.chain})`);
      }
      collateralUsd += valueUsd;
      collateralDetail.push({
        walletId: c.walletId,
        walletLabel: c.walletLabel,
        chain: c.chain,
        symbol: c.symbol,
        quantity: c.quantity,
        priceUsd: assetPrice?.priceUsd ?? null,
        valueUsd,
        priceStale: assetPrice?.stale ?? false,
      });
    }

    // --- Ручные записи ---
    const manualEntries: ManualDetail[] = [];
    let manualUsd = 0;
    for (const m of input.manual) {
      if (m.category !== category) continue;
      const amount = toNumber(m.amount);
      // btc/eth вносятся в монетах -> в доллары по цене категории;
      // stable вносится уже в долларах.
      const valueUsd = price ? amount * price.priceUsd : 0;
      if (!price) {
        warnings.push(`нет цены ${CATEGORY_LABELS[category]}: запись «${m.label}» не оценена`);
      }
      manualUsd += valueUsd;
      manualEntries.push({
        id: m.id,
        label: m.label,
        amount: m.amount,
        valueUsd,
      });
    }

    const amountUsd = collateralUsd + manualUsd;

    return {
      category,
      label: CATEGORY_LABELS[category],
      unit: CATEGORY_UNITS[category],
      // Количество категории = стоимость / цена категории (BTC/ETH-эквивалент)
      amount: price ? (price.priceUsd > 0 ? amountUsd / price.priceUsd : 0) : null,
      amountUsd,
      price: price?.priceUsd ?? null,
      priceStale: price?.stale ?? false,
      percent: 0, // заполняется ниже, когда известен итог
      targetPercent: null,
      percentDiff: null,
      amountToBalance: null,
      breakdown: { collateralUsd, manualUsd },
      collateralDetail,
      manualEntries,
      warnings,
    };
  });

  const totalUsd = rows.reduce((sum, r) => sum + r.amountUsd, 0);

  for (const row of rows) {
    row.percent = totalUsd > 0 ? (row.amountUsd / totalUsd) * 100 : 0;

    const target = input.targets[row.category];
    if (typeof target !== "number") continue;

    row.targetPercent = target;
    row.percentDiff = row.percent - target;
    // (цель% × итог − стоимость) / цена категории; минус = продать
    row.amountToBalance =
      row.price && row.price > 0
        ? ((target / 100) * totalUsd - row.amountUsd) / row.price
        : null;
  }

  const targetSumPct = PORTFOLIO_CATEGORIES.reduce((sum, category) => {
    const target = input.targets[category];
    return sum + (typeof target === "number" ? target : 0);
  }, 0);

  return {
    totalUsd,
    rows,
    targetSumPct: Math.round(targetSumPct * 1000) / 1000,
    oldestPriceAt:
      usedPriceAt.length > 0 ? usedPriceAt.slice().sort()[0] : null,
    anyPriceStale,
  };
}

/** Валидация набора целей: сумма ≠ 100 — предупреждение, НЕ блокировка. */
export function validateTargets(
  targets: { category: PortfolioCategory; targetPct: number }[],
): { sumPct: number; warning: string | null } {
  const sumPct =
    Math.round(targets.reduce((s, t) => s + t.targetPct, 0) * 1000) / 1000;
  if (targets.length === 0) return { sumPct: 0, warning: null };
  const warning =
    Math.abs(sumPct - 100) < 0.001
      ? null
      : `Сумма целей ${sumPct}% — отклонения считаются от заданных целей`;
  return { sumPct, warning };
}
