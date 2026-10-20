import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildClosureRows,
  CLOSURE_CONFLICT,
  vanishedAsPositionRows,
  type MarkRow,
  type VanishedRow,
} from "@/lib/positions/closures";
import type { PositionProtocol } from "@/lib/api/types";
import { positionPriceIds } from "@/lib/positions/positions";
import { getCoinPrices } from "@/lib/prices/coins";

/**
 * Запись закрытий и удаление исчезнувших позиций — одним вызовом вместо
 * inline-удаления, которое было у каждого из четырёх читателей.
 *
 * ПОРЯДОК «СНАЧАЛА ЗАПИСАТЬ, ПОТОМ УДАЛИТЬ» ВЫБРАН СОЗНАТЕЛЬНО. Обратный
 * (delete … returning — он в этой версии postgrest-js доступен) атомарен,
 * но при падении вставки позиция исчезает И остаётся незаписанной, то есть
 * теряется единственный носитель истории. Здесь же упавшее удаление чинится
 * само: следующее обновление повторит вставку, а уникальный ключ её погасит,
 * потому что updated_at обречённой строки не изменился. Тот же ключ гасит
 * и гонку двух обновлений: крон снепшотов в 03:00 UTC дебаунса не знает,
 * и одновременная сборка мусора по одному кошельку возможна.
 *
 * ЦЕНЫ БЕРУТСЯ ТОЛЬКО ИЗ КЭША (fetchIfExpired: false). Сборка мусора не
 * должна ходить во внешний прайсер: нужна та цена, которую последней
 * показывал экран, а не самая свежая. Устаревшая цена из coin_prices для
 * «последнего показания» — правильный ответ, поход в CoinGecko — нет.
 *
 * Вызывается ТОЛЬКО для сетей, которые ответили: гарда у вызывающего, там
 * же, где она была у удаления. Отказ чтения закрытием не считается.
 */
export async function closeVanishedPositions(
  admin: SupabaseClient,
  params: {
    userId: string;
    walletId: string;
    protocol: PositionProtocol;
    chain: string;
    /** external_id позиций, которые сеть подтвердила живыми. */
    aliveExternalIds: string[];
    /** Одно «сейчас» на всё обновление — у пачки закрытий один момент. */
    closedAt?: string;
  },
): Promise<void> {
  const { userId, walletId, protocol, chain, aliveExternalIds } = params;
  const closedAt = params.closedAt ?? new Date().toISOString();

  let doomedQuery = admin
    .from("protocol_positions")
    .select(
      "id, protocol, chain, external_id, quantity, value_usd, payload, updated_at",
    )
    .eq("wallet_id", walletId)
    .eq("protocol", protocol)
    .eq("chain", chain);
  if (aliveExternalIds.length > 0) {
    doomedQuery = doomedQuery.not(
      "external_id",
      "in",
      `(${aliveExternalIds.join(",")})`,
    );
  }
  const { data: doomedData, error: doomedError } = await doomedQuery;
  if (doomedError) {
    throw new Error(
      `protocol_positions (${protocol}) закрытие, выборка: ${doomedError.message}`,
    );
  }
  // Обычный путь обновления платит здесь один дешёвый select и уходит:
  // ни за ценами, ни за разметкой, ни на удаление
  const doomed = (doomedData ?? []) as VanishedRow[];
  if (doomed.length === 0) return;

  const externalIds = doomed.map((row) => row.external_id);

  // Разметку читаем ровно по закрываемым позициям. Она переживёт удаление,
  // но при повторном входе в тот же рынок будет перезаписана, поэтому
  // в запись уходит снимок, а не ссылка
  const { data: marks, error: marksError } = await admin
    .from("position_marks")
    .select(
      "external_id, zone, own_principal_usd, borrowed_principal_usd, withdrawn_usd, entry_price_usd",
    )
    .eq("user_id", userId)
    .eq("protocol", protocol)
    .eq("chain", chain)
    .in("external_id", externalIds);
  if (marksError) {
    throw new Error(
      `position_marks (${protocol}) закрытие, выборка: ${marksError.message}`,
    );
  }

  const priceIds = positionPriceIds(vanishedAsPositionRows(doomed, walletId));
  const prices =
    priceIds.length > 0
      ? await getCoinPrices(priceIds, { admin, fetchIfExpired: false })
      : new Map();
  const pricesUsd = new Map(
    [...prices.entries()].map(([id, p]) => [id, p.priceUsd]),
  );

  const closures = buildClosureRows({
    userId,
    walletId,
    rows: doomed,
    marks: (marks ?? []) as MarkRow[],
    pricesUsd,
    closedAt,
  });

  const { error: insertError } = await admin
    .from("closed_positions")
    .upsert(closures, { onConflict: CLOSURE_CONFLICT, ignoreDuplicates: true });
  if (insertError) {
    throw new Error(
      `closed_positions (${protocol}) запись: ${insertError.message}`,
    );
  }

  // Удаляем именно записанные строки, а не повторяем фильтр: адресное
  // удаление не унесёт позицию, появившуюся рядом между двумя запросами
  const { error: deleteError } = await admin
    .from("protocol_positions")
    .delete()
    .eq("wallet_id", walletId)
    .eq("protocol", protocol)
    .eq("chain", chain)
    .in("external_id", externalIds);
  if (deleteError) {
    throw new Error(
      `protocol_positions (${protocol}) cleanup: ${deleteError.message}`,
    );
  }
}
