import type { FundsMark } from "@/lib/api/types";

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

/**
 * Подписи категорий. Латиницей в интерфейсе пишутся только зоны стратегии
 * (дизайн-код §7), категории — по-русски: «Стейблы», не «Stablecoins».
 * Тикеры BTC и ETH — имена активов, а не английские слова, и остаются как есть.
 */
export const CATEGORY_LABELS: Record<PortfolioCategory, string> = {
  btc: "BTC",
  eth: "ETH",
  stable: "Стейблы",
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

/**
 * Свободные средства на кошельке — то, что лежит на адресе и не участвует
 * ни в залоге, ни в позициях (читаются chains/reader.ts).
 *
 * Отдельный вход, а не ручная запись, по двум причинам. Первая: ручная
 * запись оценивается по цене КАТЕГОРИИ, а свободный wstETH надо оценивать
 * по своей — иначе он завысил бы количество ETH почти на четверть (главное
 * правило движка, см. шапку модуля). Вторая: у баланса есть кошелек, сеть,
 * контракт, свежесть чтения и метка происхождения, которых в ManualInput нет.
 */
export interface FreeBalanceInput {
  /** `${walletId}:${chain}:${token}` — им же адресуется PUT разметки. */
  key: string;
  walletId: string;
  walletLabel: string | null;
  chain: string;
  /** 'native' или lowercase-адрес контракта — как в balance_marks.token. */
  token: string;
  symbol: string;
  /** null = токен вне трех категорий: в портфель не входит (см. freeOther). */
  category: PortfolioCategory | null;
  coingeckoId: string | null;
  /** Количество монет десятичной строкой (formatUnits по decimals). */
  quantity: string;
  /** null = не размечено; считается своим, но пересчитывается отдельно. */
  funds: FundsMark | null;
  /** Момент чтения баланса: свежесть балансов и свежесть цен — разное. */
  updatedAt: string;
}

export interface PriceInput {
  priceUsd: number;
  fetchedAt: string;
  stale: boolean;
}

export interface ComputeInput {
  collateral: CollateralInput[];
  manual: ManualInput[];
  /**
   * Свободные средства кошельков. Необязательное: до включения чтения
   * балансов вызывающие его не передавали, и поведение движка без него
   * должно остаться прежним до последней цифры.
   */
  free?: FreeBalanceInput[];
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

export interface FreeBalanceDetail {
  key: string;
  walletId: string;
  walletLabel: string | null;
  chain: string;
  token: string;
  symbol: string;
  quantity: string;
  priceUsd: number | null;
  valueUsd: number;
  priceStale: boolean;
  funds: FundsMark | null;
  /**
   * false = заемные: в стоимость категории не входят (портфель ведется
   * по собственным средствам — ровно поэтому из категорий вычитаются
   * собственные доли позиций), но из списка не исчезают: иначе вопрос
   * «почему сумма не сходится с тем, что я вижу в кошельке» без ответа.
   */
  countedInCategory: boolean;
  updatedAt: string;
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
  breakdown: { collateralUsd: number; manualUsd: number; freeUsd: number };
  collateralDetail: CollateralDetail[];
  manualEntries: ManualDetail[];
  /** Свободные средства категории: свои, неразмеченные И заемные. */
  freeBalances: FreeBalanceDetail[];
  /** Проблемы, которые нужно показать пользователю (не молчать). */
  warnings: string[];
}

/** Токен, который портфель не ведет: без категории и без оценки. */
export interface FreeOtherDetail {
  walletId: string;
  walletLabel: string | null;
  chain: string;
  symbol: string;
  quantity: string;
}

export interface PortfolioResult {
  totalUsd: number;
  rows: PortfolioRow[];
  targetSumPct: number;
  /** Самая старая цена среди использованных — для метки свежести. */
  oldestPriceAt: string | null;
  anyPriceStale: boolean;
  /** Заемные свободные: в категории не входят, в «Активы» входят. */
  freeBorrowedUsd: number;
  /** Свободные свои и неразмеченные — то, что вошло в категории. */
  freeOwnUsd: number;
  /** Сколько балансов не размечено: молчаливого умолчания быть не должно. */
  unmarkedFreeCount: number;
  /** Пыль ниже порога: скрыта, но названа числом — не теряется молча. */
  freeDust: { count: number; valueUsd: number };
  /** Токены вне трех категорий: не оцениваются и в «Активы» не входят. */
  freeOther: FreeOtherDetail[];
}

const DEFAULT_CATEGORY_IDS = { btc: "bitcoin", eth: "ethereum" } as const;

/**
 * Порог пыли для свободных средств, в долларах.
 *
 * Порог именно долларовый, а не количественный: 0,001 BTC — это не пыль,
 * а 3000 SHIB — пыль, и различить их можно только после оценки. Поэтому
 * отсечение живет здесь, а не в читателе: кэш хранит показания, а не
 * решения, и передумать про порог должно быть можно без повторного чтения
 * сети.
 *
 * Отсеченное не пропадает молча — уходит в freeDust отдельным числом.
 */
export const FREE_DUST_USD = 1;

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

  // --- Свободные средства: оценка и отсев до раскладки по категориям ---
  //
  // Считается один раз, а не внутри цикла по категориям: пыль и токены вне
  // трех категорий не принадлежат ни одной строке, а число неразмеченных
  // нужно по портфелю целиком.
  const freeOther: FreeOtherDetail[] = [];
  const freeDust = { count: 0, valueUsd: 0 };
  const freeByCategory: Record<PortfolioCategory, FreeBalanceDetail[]> = {
    btc: [],
    eth: [],
    stable: [],
  };
  const freeWarnings: Record<PortfolioCategory, string[]> = {
    btc: [],
    eth: [],
    stable: [],
  };
  let freeBorrowedUsd = 0;
  let freeOwnUsd = 0;
  let unmarkedFreeCount = 0;

  for (const b of input.free ?? []) {
    // Токен вне трех категорий (LINK, ARB, аирдропы) — не оцениваем вовсе:
    // зоны стратегии у него нет, и выдумать ее значило бы порвать инвариант
    // «сумма зон = Активы». Показываем количеством, без долларов.
    if (b.category === null) {
      freeOther.push({
        walletId: b.walletId,
        walletLabel: b.walletLabel,
        chain: b.chain,
        symbol: b.symbol,
        quantity: b.quantity,
      });
      continue;
    }

    // Стейбл — по фиксированной цене; BTC/ETH-подобные — по СВОЕЙ цене,
    // как залог: свободный wstETH это не 1 ETH
    const assetPrice =
      b.category === "stable"
        ? { priceUsd: stablePrice, fetchedAt: "", stale: false }
        : b.coingeckoId
          ? (input.prices.get(b.coingeckoId) ?? null)
          : null;
    const valueUsd = assetPrice ? toNumber(b.quantity) * assetPrice.priceUsd : 0;
    if (assetPrice) {
      if (assetPrice.fetchedAt) usedPriceAt.push(assetPrice.fetchedAt);
      if (assetPrice.stale) anyPriceStale = true;
    } else {
      freeWarnings[b.category].push(
        `нет цены для ${b.symbol} (${b.chain}, свободный баланс)`,
      );
    }

    if (valueUsd < FREE_DUST_USD) {
      freeDust.count += 1;
      freeDust.valueUsd += valueUsd;
      continue;
    }

    if (b.funds === null) unmarkedFreeCount += 1;
    // Заемные в категорию не входят: она ведется по собственным средствам.
    // В «Активы» и в зоны они входят целиком — иначе Чистая была бы занижена
    // ровно на эту сумму (долг-то вычитается полностью).
    const countedInCategory = b.funds !== "borrowed";
    if (countedInCategory) freeOwnUsd += valueUsd;
    else freeBorrowedUsd += valueUsd;

    freeByCategory[b.category].push({
      key: b.key,
      walletId: b.walletId,
      walletLabel: b.walletLabel,
      chain: b.chain,
      token: b.token,
      symbol: b.symbol,
      quantity: b.quantity,
      priceUsd: assetPrice?.priceUsd ?? null,
      valueUsd,
      priceStale: assetPrice?.stale ?? false,
      funds: b.funds,
      countedInCategory,
      updatedAt: b.updatedAt,
    });
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

    // --- Свободные средства категории ---
    const freeBalances = freeByCategory[category];
    warnings.push(...freeWarnings[category]);
    const freeUsd = freeBalances.reduce(
      (sum, b) => sum + (b.countedInCategory ? b.valueUsd : 0),
      0,
    );

    const amountUsd = collateralUsd + manualUsd + freeUsd;

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
      breakdown: { collateralUsd, manualUsd, freeUsd },
      collateralDetail,
      manualEntries,
      freeBalances,
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
    freeBorrowedUsd,
    freeOwnUsd,
    unmarkedFreeCount,
    freeDust,
    freeOther,
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
