/**
 * Леджер сделок: реплей журнала и взвешенная средняя цена покупки (ТЗ 03 S2.1).
 *
 * Чистые функции без I/O — загрузка сделок из БД снаружи (load.ts, роуты).
 *
 * Метод расчета — взвешенная средняя, формулы ТЗ буквально:
 *   покупка:  avg = (qty × avg + q × price) / (qty + q); qty += q
 *   продажа:  qty −= q; средняя НЕ меняется; realized += q × (price − avg)
 *   обнуление qty: следующая покупка начинает среднюю заново — естественное
 *     следствие формулы при qty = 0 (слагаемое qty × avg исчезает)
 *   oversell (q > qty): предупреждение, НЕ блокировка; qty клампится в 0
 *
 * Комиссии в среднюю НЕ входят (формула ТЗ их не содержит) — копятся
 * отдельной суммой totalFeesUsd по категории.
 */

import {
  CATEGORY_UNITS,
  PORTFOLIO_CATEGORIES,
  type PortfolioCategory,
} from "./portfolio";

export interface LedgerTrade {
  category: PortfolioCategory;
  side: "buy" | "sell";
  /** Количество в единицах категории (BTC / ETH / USD), десятичной строкой. */
  quantity: string;
  /** Цена за единицу в USD на момент сделки. */
  priceUsd: string;
  feeUsd: string | null;
  /** ISO — определяет порядок реплея. */
  tradedAt: string;
  /** ISO — стабильный tiebreak при равных traded_at. */
  createdAt: string;
}

export interface CategoryLedger {
  /** Количество по леджеру; при oversell клампится в 0, не уходит в минус. */
  ledgerQty: number;
  /** null — покупок еще не было: «нет данных о цене покупки», не ноль. */
  avgPriceUsd: number | null;
  /** Суммарный realized P/L по продажам. */
  realizedPnlUsd: number;
  /** Комиссии отдельно от средней (формула ТЗ их не учитывает). */
  totalFeesUsd: number;
  /** Oversell и прочие аномалии — предупреждения, не блокировки. */
  warnings: string[];
  /** Число сделок категории — отличает «пустой леджер» от «всё продано». */
  tradeCount: number;
}

export type LedgerResult = Record<PortfolioCategory, CategoryLedger>;

/**
 * Допуск на пыль double-арифметики: продажа «всего» после покупок
 * 0.1 + 0.2 не должна давать oversell-предупреждение из-за 4e-17.
 * Порог много меньше практической гранулярности (сатоши = 1e-8 BTC).
 */
const QTY_EPSILON = 1e-12;

/** Порог мягкого предупреждения о расхождении леджера с фактом: 1% (S2.2). */
export const DISCREPANCY_THRESHOLD = 0.01;

/** Мусор в числовой строке трактуем как 0 — единый стиль с portfolio.ts. */
function toNumber(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function emptyCategoryLedger(): CategoryLedger {
  return {
    ledgerQty: 0,
    avgPriceUsd: null,
    realizedPnlUsd: 0,
    totalFeesUsd: 0,
    warnings: [],
    tradeCount: 0,
  };
}

/**
 * Полный реплей журнала: сортировка по traded_at, затем created_at
 * (стабильный tiebreak — Array.prototype.sort стабилен), и применение
 * формул ТЗ по каждой категории независимо.
 */
export function replayTrades(trades: LedgerTrade[]): LedgerResult {
  const ordered = [...trades].sort((a, b) => {
    const byTradedAt = Date.parse(a.tradedAt) - Date.parse(b.tradedAt);
    if (byTradedAt !== 0) return byTradedAt;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });

  const result = emptyLedgerResult();

  for (const trade of ordered) {
    const s = result[trade.category];
    if (!s) continue; // неизвестная категория — не бывает при check в БД
    s.tradeCount += 1;

    const q = toNumber(trade.quantity);
    const price = toNumber(trade.priceUsd);
    if (!(q > 0)) {
      // В БД quantity > 0 (check); сюда попадает только мусорная строка
      s.warnings.push(
        `сделка ${trade.tradedAt.slice(0, 10)}: некорректное количество «${trade.quantity}» пропущено`,
      );
      continue;
    }
    s.totalFeesUsd += trade.feeUsd === null ? 0 : toNumber(trade.feeUsd);

    if (trade.side === "buy") {
      // avg = (qty × avg + q × price) / (qty + q); при qty = 0 (в т.ч. после
      // полной продажи) слагаемое qty × avg исчезает и средняя начинается
      // заново — это и есть «сброс при обнулении» из ТЗ.
      const base = s.avgPriceUsd !== null ? s.ledgerQty * s.avgPriceUsd : 0;
      s.avgPriceUsd = (base + q * price) / (s.ledgerQty + q);
      s.ledgerQty += q;
      continue;
    }

    // --- Продажа ---
    if (q > s.ledgerQty + QTY_EPSILON) {
      const unit = CATEGORY_UNITS[trade.category];
      s.warnings.push(
        `продажа ${q} ${unit} от ${trade.tradedAt.slice(0, 10)} превышает учтенное количество (${s.ledgerQty} ${unit}) — количество по леджеру обнулено`,
      );
    }
    if (s.avgPriceUsd !== null) {
      // realized = q × (price − avg) на ВЕСЬ объем продажи, включая часть
      // сверх учтенного количества (кламп ниже касается только qty):
      // средняя — единственная известная себестоимость, и молча выкидывать
      // «лишнюю» часть продажи из P/L хуже, чем посчитать ее по той же
      // средней; о расхождении уже сообщает предупреждение выше.
      s.realizedPnlUsd += q * (price - s.avgPriceUsd);
    }
    // Продажа до первой покупки (avg = null): себестоимости нет вообще —
    // realized не начисляем (нельзя выдумать базу), остается предупреждение.
    s.ledgerQty = Math.max(0, s.ledgerQty - q);
    if (s.ledgerQty < QTY_EPSILON) s.ledgerQty = 0; // пыль double после «продал все»
  }

  return result;
}

/** Блок ledger в строке портфеля (S2.2): null-safe, без фиктивных нулей. */
export interface LedgerRowInfo {
  avgPriceUsd: number | null;
  /** ledgerQty × (текущая цена − средняя); null без средней или цены. */
  unrealizedPnlUsd: number | null;
  /** (текущая / средняя − 1) × 100; null без средней или цены. */
  unrealizedPnlPct: number | null;
  realizedPnlUsd: number;
  ledgerQty: number;
  /**
   * Мягкое предупреждение о расхождении количества по леджеру и фактического
   * (залог + ручные записи). null — нет сделок, нет факта или расхождение
   * в пределах порога. diff = ledgerQty − actualQty (плюс: леджер насчитал
   * больше, чем есть на самом деле). Никогда не блокирует отображение.
   */
  discrepancy: { ledgerQty: number; actualQty: number; diff: number } | null;
  warnings: string[];
}

/**
 * Unrealized P/L и расхождение — на уровне портфеля, где известны текущая
 * цена категории и фактическое количество (row.price / row.amount).
 */
export function buildLedgerRowInfo(
  ledger: CategoryLedger,
  opts: { currentPriceUsd: number | null; actualQty: number | null },
): LedgerRowInfo {
  const { avgPriceUsd, ledgerQty, realizedPnlUsd, warnings } = ledger;
  const price = opts.currentPriceUsd;

  const unrealizedPnlUsd =
    avgPriceUsd !== null && price !== null
      ? ledgerQty * (price - avgPriceUsd)
      : null;
  // Процент не определен при средней 0 (бесплатное поступление) — null, не ∞
  const unrealizedPnlPct =
    avgPriceUsd !== null && avgPriceUsd > 0 && price !== null
      ? (price / avgPriceUsd - 1) * 100
      : null;

  let discrepancy: LedgerRowInfo["discrepancy"] = null;
  if (ledger.tradeCount > 0 && opts.actualQty !== null) {
    const actualQty = opts.actualQty;
    const diff = ledgerQty - actualQty;
    const denom = Math.max(Math.abs(ledgerQty), Math.abs(actualQty));
    if (denom > 0 && Math.abs(diff) / denom > DISCREPANCY_THRESHOLD) {
      discrepancy = { ledgerQty, actualQty, diff };
    }
  }

  return {
    avgPriceUsd,
    unrealizedPnlUsd,
    unrealizedPnlPct,
    realizedPnlUsd,
    ledgerQty,
    discrepancy,
    warnings,
  };
}

/** Пустой реплей: все категории из единого источника истины. */
export function emptyLedgerResult(): LedgerResult {
  return Object.fromEntries(
    PORTFOLIO_CATEGORIES.map((category) => [category, emptyCategoryLedger()]),
  ) as LedgerResult;
}
