import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api/auth";
import { POSITION_SOURCES } from "@/lib/positions/sources";
import {
  POSITION_PROTOCOLS,
  buildPositions,
  positionPriceIds,
  zoneKeyOf,
  type PositionMark,
  type PositionRowInput,
} from "@/lib/positions/positions";
import { getCoinPrices } from "@/lib/prices/coins";
import type { LeverageResponseDto, StrategyZone } from "@/lib/api/types";

/**
 * GET /api/leverage — размещение заёмных средств: позиции блока «Где работают
 * заёмные» на экране «Долг».
 *
 * Только кэши (protocol_positions + coin_prices), без RPC и без походов
 * в CoinGecko: свежие данные приносит POST /api/refresh. Пустое состояние —
 * нормальный ответ, а не ошибка.
 *
 * Привязки «займ → позиция» здесь больше нет: заём уходит в разные позиции
 * по частям, и отношение «один заём — одна позиция» этого не описывает.
 * Сам долг живёт на /api/debt.
 */
export async function GET() {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  try {
    const { data: wallets, error: walletsError } = await supabase
      .from("wallets")
      .select("id, label");
    if (walletsError) return apiError(500, walletsError.message);
    const walletById = new Map(
      (wallets ?? []).map((w) => [w.id as string, (w.label as string | null) ?? null]),
    );
    const walletIds = [...walletById.keys()];

    // Разметка живет отдельно от строк читателя: тот их пересоздает
    const { data: markRows, error: marksError } = await supabase
      .from("position_marks")
      .select("protocol, chain, external_id, zone, own_principal_usd, borrowed_principal_usd, withdrawn_usd, entry_price_usd");
    if (marksError) return apiError(500, marksError.message);
    const marksByKey = new Map<string, PositionMark>(
      (markRows ?? []).map((r) => [
        zoneKeyOf({
          protocol: r.protocol as string,
          chain: r.chain as string,
          externalId: r.external_id as string,
        }),
        {
          zone: (r.zone as StrategyZone | null) ?? null,
          ownPrincipalUsd:
            r.own_principal_usd === null ? null : Number(r.own_principal_usd),
          borrowedPrincipalUsd:
            r.borrowed_principal_usd === null
              ? null
              : Number(r.borrowed_principal_usd),
          withdrawnUsd: r.withdrawn_usd === null ? null : Number(r.withdrawn_usd),
          entryPriceUsd:
            r.entry_price_usd === null ? null : Number(r.entry_price_usd),
        } satisfies PositionMark,
      ]),
    );

    const positionRows: PositionRowInput[] = [];
    const chains: LeverageResponseDto["chains"] = [];

    if (walletIds.length > 0) {
      const { data: rows, error: rowsError } = await supabase
        .from("protocol_positions")
        .select(
          "id, wallet_id, protocol, chain, external_id, quantity, value_usd, payload, updated_at",
        )
        .in("protocol", [...POSITION_PROTOCOLS])
        .in("wallet_id", walletIds);
      if (rowsError) return apiError(500, rowsError.message);

      // Строки Aave (залог и долг) не выбираются вовсе: долг отдаёт
      // /api/debt, залог посчитан категориями портфеля
      for (const row of rows ?? []) {
        positionRows.push({
          id: row.id as string,
          protocol: row.protocol as string,
          chain: row.chain as string,
          externalId: row.external_id as string,
          quantity: row.quantity === null ? null : String(row.quantity),
          valueUsd: row.value_usd === null ? null : Number(row.value_usd),
          payload: row.payload,
          updatedAt: row.updated_at as string,
          walletId: row.wallet_id as string,
          walletLabel: walletById.get(row.wallet_id as string) ?? null,
        });
      }

      // Статус чтения источников Фазы 5: «позиций нет» и «не смогли прочитать»
      // должны выглядеть по-разному
      const { data: statusRows, error: statusError } = await supabase
        .from("chain_read_status")
        .select("source, chain, ok, error")
        .in("source", [...POSITION_SOURCES])
        .in("wallet_id", walletIds);
      if (statusError) return apiError(500, statusError.message);

      const worstByKey = new Map<string, LeverageResponseDto["chains"][number]>();
      for (const row of statusRows ?? []) {
        const key = `${row.source}:${row.chain}`;
        const next = {
          chain: row.chain as string,
          source: row.source as string,
          ok: row.ok as boolean,
          ...(row.error ? { error: row.error as string } : {}),
        };
        const current = worstByKey.get(key);
        // Отказ важнее успеха: сеть неисправна, если упала хоть по одному кошельку
        if (!current || (current.ok && !next.ok)) worstByKey.set(key, next);
      }
      chains.push(...worstByKey.values());
    }

    // Цены: только компоненты позиций — долг оценивает /api/debt
    const priceIds = positionPriceIds(positionRows);
    const prices = await getCoinPrices(priceIds, { fetchIfExpired: false });
    const pricesUsd = new Map(
      [...prices.values()].map((p) => [p.coingeckoId, p.priceUsd] as const),
    );

    const { positions, summary } = buildPositions({
      rows: positionRows,
      pricesUsd,
      marksByKey,
    });

    const response: LeverageResponseDto = { positions, summary, chains };
    return NextResponse.json(response);
  } catch (err) {
    return apiError(
      500,
      err instanceof Error
        ? err.message
        : "Не удалось собрать данные о размещении",
    );
  }
}
