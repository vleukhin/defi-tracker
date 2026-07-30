import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AAVE_PROTOCOL, type AavePositionPayload } from "@/lib/chains/aave";
import {
  CATEGORY_COINGECKO_IDS,
  STABLE_PRICE_USD,
  getCoinPrices,
} from "@/lib/prices/coins";
import {
  computePortfolio,
  type CollateralInput,
  type ManualInput,
  type PortfolioCategory,
  type PortfolioResult,
} from "./portfolio";

/**
 * Сборка входных данных портфеля из БД и вызов движка.
 *
 * Читается клиентом ПОЛЬЗОВАТЕЛЯ (RLS сама ограничивает выборку своими
 * кошельками и записями); цены — общий кэш через service-role.
 */

export interface WalletRow {
  id: string;
  address: string;
  label: string | null;
  last_refreshed_at: string | null;
}

export interface ChainStatusRow {
  chain: string;
  ok: boolean;
  error: string | null;
  checked_at: string;
}

export interface LoadPortfolioResult extends PortfolioResult {
  wallets: WalletRow[];
  /** Статус последнего чтения по сетям (агрегировано по кошелькам). */
  chains: ChainStatusRow[];
  oldestCollateralAt: string | null;
}

export interface LoadOptions {
  /** true = дотянуть истекшие цены (refresh); false = только кэш (дашборд). */
  fetchIfExpired?: boolean;
  nowMs?: number;
}

export async function loadPortfolio(
  supabase: SupabaseClient,
  userId: string,
  opts: LoadOptions = {},
): Promise<LoadPortfolioResult> {
  const { data: walletRows, error: walletsError } = await supabase
    .from("wallets")
    .select("id, address, label, last_refreshed_at")
    .order("created_at", { ascending: true });
  if (walletsError) throw new Error(`wallets: ${walletsError.message}`);
  const wallets = (walletRows ?? []) as WalletRow[];
  const walletById = new Map(wallets.map((w) => [w.id, w]));

  // --- Залог Aave ---
  const collateral: CollateralInput[] = [];
  let oldestCollateralAt: string | null = null;
  if (wallets.length > 0) {
    const { data: positions, error: positionsError } = await supabase
      .from("protocol_positions")
      .select("wallet_id, chain, quantity, payload, updated_at")
      .eq("protocol", AAVE_PROTOCOL);
    if (positionsError)
      throw new Error(`protocol_positions: ${positionsError.message}`);

    for (const row of positions ?? []) {
      const payload = row.payload as AavePositionPayload | null;
      if (!payload?.category || !payload.coingeckoId) continue;
      const wallet = walletById.get(row.wallet_id as string);
      collateral.push({
        walletId: row.wallet_id as string,
        walletLabel: wallet?.label ?? null,
        chain: row.chain as string,
        symbol: payload.symbol,
        category: payload.category,
        coingeckoId: payload.coingeckoId,
        quantity: String(row.quantity ?? "0"),
      });
      const updatedAt = row.updated_at as string | null;
      if (updatedAt && (!oldestCollateralAt || updatedAt < oldestCollateralAt)) {
        oldestCollateralAt = updatedAt;
      }
    }
  }

  // --- Ручные записи ---
  const { data: manualRows, error: manualError } = await supabase
    .from("manual_positions")
    .select("id, category, label, amount")
    .order("created_at", { ascending: true });
  if (manualError) throw new Error(`manual_positions: ${manualError.message}`);
  const manual: ManualInput[] = (manualRows ?? []).map((r) => ({
    id: r.id as string,
    category: r.category as PortfolioCategory,
    label: r.label as string,
    amount: String(r.amount),
  }));

  // --- Цели ---
  const { data: targetRows, error: targetsError } = await supabase
    .from("portfolio_targets")
    .select("category, target_pct");
  if (targetsError)
    throw new Error(`portfolio_targets: ${targetsError.message}`);
  const targets: Partial<Record<PortfolioCategory, number>> = {};
  for (const row of targetRows ?? []) {
    targets[row.category as PortfolioCategory] = Number(row.target_pct);
  }

  // --- Цены: категории + все залоговые токены ---
  const priceIds = [
    CATEGORY_COINGECKO_IDS.btc,
    CATEGORY_COINGECKO_IDS.eth,
    ...collateral.map((c) => c.coingeckoId),
  ];
  const prices = await getCoinPrices(priceIds, {
    fetchIfExpired: opts.fetchIfExpired ?? false,
    nowMs: opts.nowMs,
  });

  const result = computePortfolio({
    collateral,
    manual,
    targets,
    prices,
    stablePriceUsd: STABLE_PRICE_USD,
    categoryIds: CATEGORY_COINGECKO_IDS,
  });

  // --- Статус чтения сетей: сеть считается деградировавшей, если упала
  // хотя бы по одному кошельку (данные портфеля в этом случае неполные) ---
  const chains: ChainStatusRow[] = [];
  if (wallets.length > 0) {
    const { data: statusRows, error: statusError } = await supabase
      .from("chain_read_status")
      .select("chain, ok, error, checked_at")
      .eq("source", AAVE_PROTOCOL);
    if (statusError)
      throw new Error(`chain_read_status: ${statusError.message}`);

    const byChain = new Map<string, ChainStatusRow>();
    for (const row of statusRows ?? []) {
      const chain = row.chain as string;
      const current = byChain.get(chain);
      const next: ChainStatusRow = {
        chain,
        ok: row.ok as boolean,
        error: (row.error as string | null) ?? null,
        checked_at: row.checked_at as string,
      };
      // Отказ важнее успеха; при равенстве — более свежая проверка
      if (
        !current ||
        (current.ok && !next.ok) ||
        (current.ok === next.ok && next.checked_at > current.checked_at)
      ) {
        byChain.set(chain, next);
      }
    }
    chains.push(...byChain.values());
  }

  return { ...result, wallets, chains, oldestCollateralAt };
}
