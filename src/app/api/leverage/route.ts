import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api/auth";
import { AAVE_PROTOCOL } from "@/lib/chains/aave";
import type { AaveDebtPositionPayload } from "@/lib/chains/aave-debt";
import { POSITION_SOURCES } from "@/lib/positions/sources";
import {
  POSITION_PROTOCOLS,
  buildPositions,
  positionPriceIds,
  zoneKeyOf,
  type PositionMark,
  type PositionRowInput,
} from "@/lib/positions/positions";
import { buildLeverage, type BorrowInput } from "@/lib/positions/leverage";
import { getCoinPrices } from "@/lib/prices/coins";
import type { LeverageResponseDto, StrategyZone } from "@/lib/api/types";

/**
 * GET /api/leverage — вкладка «Левередж» экрана «Долг» (Фаза 5).
 *
 * Только кэши (protocol_positions + manual_positions + borrow_links +
 * coin_prices), без RPC и без походов в CoinGecko: свежие данные приносит
 * POST /api/refresh. Пустое состояние — нормальный ответ, а не ошибка.
 *
 * Привязка «займ → позиция» здесь только читается и отображается: на портфель
 * и на пять чисел она не влияет (S5.3).
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
      .select("protocol, chain, external_id, zone, own_principal_usd, borrowed_principal_usd");
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
        } satisfies PositionMark,
      ]),
    );

    const positionRows: PositionRowInput[] = [];
    const borrows: BorrowInput[] = [];
    const chains: LeverageResponseDto["chains"] = [];

    if (walletIds.length > 0) {
      const { data: rows, error: rowsError } = await supabase
        .from("protocol_positions")
        .select(
          "id, wallet_id, protocol, chain, external_id, quantity, value_usd, payload, updated_at",
        )
        .in("protocol", [...POSITION_PROTOCOLS, AAVE_PROTOCOL])
        .in("wallet_id", walletIds);
      if (rowsError) return apiError(500, rowsError.message);

      for (const row of rows ?? []) {
        const protocol = row.protocol as string;
        if (protocol === AAVE_PROTOCOL) {
          const payload = row.payload as
            | (Partial<AaveDebtPositionPayload> & { kind?: string })
            | null;
          // В protocol_positions лежат и залог, и долг — займы это второе
          if (payload?.kind !== "debt" || !payload.symbol) continue;
          borrows.push({
            id: row.id as string,
            chain: row.chain as string,
            symbol: payload.symbol,
            quantity: String(row.quantity ?? "0"),
            coingeckoId: payload.coingeckoId ?? null,
          });
          continue;
        }
        positionRows.push({
          id: row.id as string,
          protocol,
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

    // Цены: компоненты позиций + занятые токены (оценка долга)
    const priceIds = [
      ...positionPriceIds(positionRows),
      ...borrows
        .map((b) => b.coingeckoId)
        .filter((id): id is string => id !== null),
    ];
    const prices = await getCoinPrices(priceIds, { fetchIfExpired: false });
    const pricesUsd = new Map(
      [...prices.values()].map((p) => [p.coingeckoId, p.priceUsd] as const),
    );

    const { positions, summary } = buildPositions({
      rows: positionRows,
      pricesUsd,
      marksByKey,
    });

    const { data: linkRows, error: linksError } = await supabase
      .from("borrow_links")
      .select("borrow_ref, position_ref");
    if (linksError) return apiError(500, linksError.message);

    const leverage = buildLeverage({
      positions,
      borrows,
      links: (linkRows ?? []).map((l) => ({
        borrowId: l.borrow_ref as string,
        positionId: l.position_ref as string,
      })),
      pricesUsd,
    });

    const response: LeverageResponseDto = {
      positions,
      borrows: leverage.borrows,
      summary: {
        ...summary,
        linkedDebtUsd: leverage.linkedDebtUsd,
        linkedPositionsUsd: leverage.linkedPositionsUsd,
        linkedDeltaUsd: leverage.linkedDeltaUsd,
      },
      chains,
    };
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
