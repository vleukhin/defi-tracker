import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api/auth";
import { createTimer } from "@/lib/api/timing";
import {
  buildDebtResponse,
  type CollateralInput,
  type DebtPositionInput,
  type HealthRowInput,
} from "@/lib/api/debt";
import {
  DEFAULT_HF_WARNING_THRESHOLD,
  DEFAULT_TARGET_LTV_PCT,
} from "@/lib/api/settings";
import { AAVE_PROTOCOL } from "@/lib/chains/aave";
import type { AaveDebtPositionPayload } from "@/lib/chains/aave-debt";
import { CATEGORY_COINGECKO_IDS, getCoinPrices } from "@/lib/prices/coins";

/**
 * GET /api/debt — экран «Долг» (Фаза 4, S4.1/S4.3): по каждой сети — залог,
 * занято, health factor, коэффициент использования; итог и минимальный HF.
 *
 * Только кэши (aave_account_health + protocol_positions + coin_prices):
 * ни RPC, ни CoinGecko — обновление данных делает POST /api/refresh.
 * Пустое состояние (долга нет нигде) — нормальный ответ, не ошибка.
 */
export async function GET() {
  const timer = createTimer();
  const mark = timer.mark;
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;
  mark("auth");

  try {
    const { data: wallets, error: walletsError } = await supabase
      .from("wallets")
      .select("id");
    if (walletsError) return apiError(500, walletsError.message);
    const walletIds = (wallets ?? []).map((w) => w.id as string);

    // Порог предупреждения и цель плеча — из настроек, до первого PUT
    // действуют дефолты. Цель едет здесь, а не отдельным запросом настроек:
    // лента сигналов на «Портфеле» сравнивает её с LTV этого же ответа.
    const { data: settingsRow, error: settingsError } = await supabase
      .from("user_settings")
      .select("hf_warning_threshold, target_ltv_pct")
      .maybeSingle();
    if (settingsError) return apiError(500, settingsError.message);
    const hfWarningThreshold =
      settingsRow === null
        ? DEFAULT_HF_WARNING_THRESHOLD
        : Number(settingsRow.hf_warning_threshold);
    const targetLtvPct =
      settingsRow === null
        ? DEFAULT_TARGET_LTV_PCT
        : Number(settingsRow.target_ltv_pct);

    const healthRows: HealthRowInput[] = [];
    const positions: DebtPositionInput[] = [];
    const collateral: CollateralInput[] = [];

    if (walletIds.length > 0) {
      const { data: health, error: healthError } = await supabase
        .from("aave_account_health")
        .select(
          "wallet_id, chain, total_collateral_usd, total_debt_usd, health_factor, checked_at",
        )
        .in("wallet_id", walletIds);
      if (healthError) return apiError(500, healthError.message);
      for (const row of health ?? []) {
        healthRows.push({
          chain: row.chain as string,
          totalCollateralUsd:
            row.total_collateral_usd === null
              ? null
              : Number(row.total_collateral_usd),
          totalDebtUsd:
            row.total_debt_usd === null ? null : Number(row.total_debt_usd),
          healthFactor:
            row.health_factor === null ? null : Number(row.health_factor),
          checkedAt: row.checked_at as string,
        });
      }

      const { data: positionRows, error: positionsError } = await supabase
        .from("protocol_positions")
        .select("chain, quantity, payload")
        .eq("protocol", AAVE_PROTOCOL)
        .in("wallet_id", walletIds);
      if (positionsError) return apiError(500, positionsError.message);
      for (const row of positionRows ?? []) {
        const payload = row.payload as
          | (Partial<AaveDebtPositionPayload> & {
              kind?: string;
              category?: string;
            })
          | null;
        // В protocol_positions лежат и залог, и долг. Долг разбирается ниже,
        // а из залога нужна одна вещь — чем он обеспечен: сценарии падения
        // переводят его в цены базовых активов
        if (payload?.kind !== "debt") {
          if (payload?.category === "btc" || payload?.category === "eth") {
            collateral.push({
              chain: row.chain as string,
              category: payload.category,
            });
          }
          continue;
        }
        if (!payload.symbol) continue;
        positions.push({
          chain: row.chain as string,
          symbol: payload.symbol,
          coingeckoId: payload.coingeckoId ?? null,
          quantity: String(row.quantity ?? "0"),
        });
      }
    }

    mark("db");

    // Оценка разбивки — только кэш цен: /api/debt обязан отвечать быстро.
    // Цены BTC и ETH берутся тем же запросом: сценарии падения залога
    // подписаны ценами базовых активов, а лишнего похода в сеть это не стоит
    const priceIds = [
      ...new Set([
        ...positions
          .map((p) => p.coingeckoId)
          .filter((id): id is string => id !== null),
        CATEGORY_COINGECKO_IDS.btc,
        CATEGORY_COINGECKO_IDS.eth,
      ]),
    ];
    const prices = await getCoinPrices(priceIds, { fetchIfExpired: false });
    mark("prices");
    const pricesUsd = new Map(
      [...prices.values()].map((p) => [p.coingeckoId, p.priceUsd] as const),
    );

    return NextResponse.json(
      buildDebtResponse({
        hasWallets: walletIds.length > 0,
        healthRows,
        positions,
        collateral,
        pricesUsd,
        basePricesUsd: {
          btc: pricesUsd.get(CATEGORY_COINGECKO_IDS.btc) ?? null,
          eth: pricesUsd.get(CATEGORY_COINGECKO_IDS.eth) ?? null,
        },
        hfWarningThreshold,
        targetLtvPct,
      }),
      { headers: timer.headers() },
    );
  } catch (err) {
    return apiError(
      500,
      err instanceof Error ? err.message : "Не удалось собрать данные о долге",
    );
  }
}
