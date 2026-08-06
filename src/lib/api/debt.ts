import { CHAIN_IDS } from "@/lib/chains/config";
import type {
  CollateralCategory,
  DebtChainDto,
  DebtItemDto,
  DebtResponseDto,
} from "./types";

/**
 * Сборка ответа GET /api/debt из кэшей (S4.1/S4.3). Чистая функция без
 * I/O — агрегация и null-семантика тестируются офлайн.
 *
 * Источники:
 *  * aave_account_health — канонические totals и HF (оракул Aave);
 *  * protocol_positions c payload.kind='debt' — best-effort разбивка;
 *  * coin_prices — оценка разбивки (где известен coingecko id).
 *
 * Несколько кошельков на сеть агрегируются: totals суммируются
 * (неизвестное слагаемое делает сумму неизвестной), HF сети — МИНИМАЛЬНЫЙ
 * по кошелькам с долгом: ликвидация приходит к худшему кошельку.
 */

export interface HealthRowInput {
  chain: string;
  totalCollateralUsd: number | null;
  totalDebtUsd: number | null;
  /** null = долга нет («∞»). */
  healthFactor: number | null;
  checkedAt: string;
}

export interface DebtPositionInput {
  chain: string;
  symbol: string;
  coingeckoId: string | null;
  /** Десятичная строка. */
  quantity: string;
}

/** Залоговая строка кэша: из неё нужна только категория. */
export interface CollateralInput {
  chain: string;
  category: CollateralCategory;
}

export interface BuildDebtInput {
  hasWallets: boolean;
  healthRows: HealthRowInput[];
  positions: DebtPositionInput[];
  /** Залог по сетям — чем обеспечен, без количеств (см. DebtChainDto). */
  collateral: CollateralInput[];
  /** Цены по coingecko id (только кэш). */
  pricesUsd: Map<string, number>;
  /**
   * Цены базовых активов — считаются вызывающим по тем же кэш-ценам:
   * соответствие «категория → coingecko id» живёт на сервере (prices/coins),
   * а этот модуль остаётся чистой агрегацией без импортов из server-only.
   */
  basePricesUsd: Record<CollateralCategory, number | null>;
  hfWarningThreshold: number;
  /** Целевой LTV, % — из тех же настроек, что и порог HF (docs/07 §8). */
  targetLtvPct: number;
}

/** Порядок колонок базовых активов — тот же, что у категорий портфеля. */
const CATEGORY_ORDER: CollateralCategory[] = ["btc", "eth"];

/** Сумма с null-пропагацией: неизвестное слагаемое — неизвестная сумма. */
function sumOrNull(values: (number | null)[]): number | null {
  let sum = 0;
  for (const v of values) {
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

export function buildDebtResponse(input: BuildDebtInput): DebtResponseDto {
  const itemsByChain = new Map<string, DebtItemDto[]>();
  for (const p of input.positions) {
    const price =
      p.coingeckoId !== null ? input.pricesUsd.get(p.coingeckoId) : undefined;
    const item: DebtItemDto = {
      symbol: p.symbol,
      chain: p.chain,
      quantity: p.quantity,
      // Нет id или цены — количество без оценки, НЕ ноль
      valueUsd:
        price === undefined ? null : Number.parseFloat(p.quantity) * price,
    };
    const list = itemsByChain.get(p.chain) ?? [];
    list.push(item);
    itemsByChain.set(p.chain, list);
  }

  const collateralByChain = new Map<string, Set<CollateralCategory>>();
  for (const c of input.collateral) {
    const set = collateralByChain.get(c.chain) ?? new Set<CollateralCategory>();
    set.add(c.category);
    collateralByChain.set(c.chain, set);
  }

  const healthByChain = new Map<string, HealthRowInput[]>();
  for (const row of input.healthRows) {
    const list = healthByChain.get(row.chain) ?? [];
    list.push(row);
    healthByChain.set(row.chain, list);
  }

  const chains: DebtChainDto[] = [];
  // Порядок сетей фиксированный; сети без данных здоровья и без долга
  // в ответ не попадают (долг там не читался — показывать нечего)
  for (const chain of CHAIN_IDS) {
    const rows = healthByChain.get(chain) ?? [];
    const items = (itemsByChain.get(chain) ?? []).sort(
      (a, b) =>
        (b.valueUsd ?? -1) - (a.valueUsd ?? -1) ||
        a.symbol.localeCompare(b.symbol),
    );
    if (rows.length === 0 && items.length === 0) continue;

    const totalCollateralUsd =
      rows.length === 0
        ? null
        : sumOrNull(rows.map((r) => r.totalCollateralUsd));
    const totalDebtUsd =
      rows.length === 0 ? null : sumOrNull(rows.map((r) => r.totalDebtUsd));

    // Минимальный HF среди кошельков с долгом; null = долга нет («∞»)
    const hfs = rows
      .map((r) => r.healthFactor)
      .filter((hf): hf is number => hf !== null);
    const healthFactor = hfs.length > 0 ? Math.min(...hfs) : null;

    const utilization =
      totalDebtUsd !== null &&
      totalCollateralUsd !== null &&
      totalCollateralUsd > 0
        ? totalDebtUsd / totalCollateralUsd
        : null;

    // Свежесть сети — по самой СТАРОЙ проверке из кошельков: свежая
    // проверка одного кошелька не делает данные другого актуальными
    const checkedAt =
      rows.length > 0
        ? rows.map((r) => r.checkedAt).sort()[0]
        : "";

    const categories = collateralByChain.get(chain);
    chains.push({
      chain,
      totalCollateralUsd,
      totalDebtUsd,
      healthFactor,
      utilization,
      items,
      // Порядок фиксированный, а не порядок строк кэша: колонки сценариев
      // не должны меняться местами от того, какой залог прочитался первым
      collateralCategories:
        categories === undefined
          ? []
          : CATEGORY_ORDER.filter((cat) => categories.has(cat)),
      checkedAt,
    });
  }

  // Итог долга: без кошельков долга нет (0); кошельки есть, а здоровье
  // не читалось ни разу — неизвестно (null, не ноль)
  let totalDebtUsd: number | null;
  if (!input.hasWallets) {
    totalDebtUsd = 0;
  } else if (input.healthRows.length === 0) {
    totalDebtUsd = null;
  } else {
    totalDebtUsd = sumOrNull(chains.map((c) => c.totalDebtUsd));
  }

  // Связывающее ограничение: минимальный HF среди сетей с долгом
  const chainHfs = chains
    .map((c) => c.healthFactor)
    .filter((hf): hf is number => hf !== null);
  const minHealthFactor = chainHfs.length > 0 ? Math.min(...chainHfs) : null;

  return {
    chains,
    basePricesUsd: input.basePricesUsd,
    summary: {
      totalDebtUsd,
      minHealthFactor,
      hfWarningThreshold: input.hfWarningThreshold,
      belowThreshold:
        minHealthFactor !== null && minHealthFactor < input.hfWarningThreshold,
      targetLtvPct: input.targetLtvPct,
    },
  };
}
