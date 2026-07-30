import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Address } from "viem";
import {
  persistAaveCollateral,
  persistChainStatus,
  readWalletAaveCollateral,
} from "@/lib/chains/aave";
import type { SnapshotDto, SnapshotItemDto } from "@/lib/api/types";
import { loadPortfolio, loadPortfolioAsAdmin } from "./load";
import type { ChainStatusRow, LoadPortfolioResult } from "./load";
import type { PortfolioCategory, PortfolioRow } from "./portfolio";

/**
 * Снепшот портфеля (Фаза 3, S3.1): состояние трех категорий на календарный
 * день. Идемпотентность обеспечивает БД — UNIQUE (user_id, taken_on).
 *
 * Что НЕ попадает в снепшот: средняя цена покупки, realized/unrealized P/L.
 * Они выводятся реплеем журнала сделок, который хранится целиком, и при
 * правке старой сделки пересчитываются задним числом. Снепшот фиксирует
 * состояние портфеля (S3.1), а не производные от леджера величины —
 * иначе история противоречила бы журналу после первой же правки.
 */

/** Данные, которых достаточно для сборки снепшота (подмножество портфеля). */
export interface SnapshotSource {
  totalUsd: number;
  rows: PortfolioRow[];
  chains: ChainStatusRow[];
}

export interface SnapshotItemInput {
  category: PortfolioCategory;
  /**
   * Количество в единицах категории. null (а не 0) — цены категории нет и
   * BTC/ETH-эквивалент не выводится: «нет данных» ≠ «ноль».
   */
  quantity: number | null;
  priceUsd: number | null;
  valueUsd: number;
  percent: number;
  collateralUsd: number;
  manualUsd: number;
}

export interface SnapshotBuild {
  totalUsd: number;
  isPartial: boolean;
  /** Человекочитаемые причины частичности — в лог cron'а и в ответ API. */
  partialReasons: string[];
  items: SnapshotItemInput[];
}

/**
 * ПРАВИЛО ЧАСТИЧНОСТИ (is_partial). Снепшот помечается частичным, если
 * хотя бы одно из:
 *
 *  1. Чтение любой сети не удалось (chains[].ok === false). По S3.1 снепшот
 *     при этом все равно снимается — по последним известным данным залога,
 *     но честно помечается.
 *  2. Цена категории отсутствует или устарела (priceStale). Стейблы
 *     зафиксированы на 1.00 и под это правило не попадают никогда.
 *  3. Цена ЛЮБОГО залогового токена отсутствует или устарела: wstETH без
 *     цены обнуляет часть стоимости категории точно так же, как отсутствие
 *     цены ETH, — молчать об этом нельзя.
 *
 * Почему так строго: точка истории, посчитанная по неполным данным, внешне
 * неотличима от настоящего падения портфеля. Ложная просадка на графике
 * хуже, чем разрыв или помеченная точка, — поэтому лучше пометить лишнего.
 *
 * Чистая функция без I/O — вся логика решения тестируется офлайн.
 */
export function buildSnapshotRows(portfolio: SnapshotSource): SnapshotBuild {
  const partialReasons: string[] = [];

  for (const chain of portfolio.chains) {
    if (!chain.ok) {
      partialReasons.push(
        `сеть ${chain.chain} недоступна${chain.error ? `: ${chain.error}` : ""}`,
      );
    }
  }

  const items: SnapshotItemInput[] = portfolio.rows.map((row) => {
    if (row.price === null) {
      partialReasons.push(`нет цены категории ${row.label}`);
    } else if (row.priceStale) {
      partialReasons.push(`цена категории ${row.label} устарела`);
    }

    for (const c of row.collateralDetail) {
      if (c.priceUsd === null) {
        partialReasons.push(`нет цены залога ${c.symbol} (${c.chain})`);
      } else if (c.priceStale) {
        partialReasons.push(`цена залога ${c.symbol} (${c.chain}) устарела`);
      }
    }

    return {
      category: row.category,
      quantity: row.amount,
      priceUsd: row.price,
      valueUsd: row.amountUsd,
      percent: row.percent,
      collateralUsd: row.breakdown.collateralUsd,
      manualUsd: row.breakdown.manualUsd,
    };
  });

  return {
    totalUsd: portfolio.totalUsd,
    isPartial: partialReasons.length > 0,
    partialReasons,
    items,
  };
}

export interface CreateSnapshotOptions {
  /** Момент съема; определяет и календарный день taken_on (UTC). */
  nowMs?: number;
  /**
   * Дотягивать истекшие цены. По умолчанию true: снепшот — это точка
   * истории, снимать ее по протухшему кэшу бессмысленно.
   */
  fetchIfExpired?: boolean;
  /**
   * Чем ограничена выборка портфеля:
   *  * "rls" (по умолчанию) — userSupabase создан ключом пользователя;
   *  * "admin" — читает service-role клиент, фильтр по user_id ставится явно.
   * Значение обязано соответствовать переданному клиенту — несоответствие
   * ловится проверкой ниже, потому что ошибка здесь означает утечку.
   */
  readerScope?: "rls" | "admin";
}

export interface CreateSnapshotResult {
  snapshot: SnapshotDto;
  partialReasons: string[];
}

interface SnapshotRow {
  id: string;
  taken_on: string;
  taken_at: string;
  total_usd: number | string;
  is_partial: boolean;
}

/**
 * Снять снепшот пользователя и записать его.
 *
 * @param userSupabase клиент для ЧТЕНИЯ портфеля. Обычный путь — клиент
 *   пользователя (режет RLS); путь cron'а — service-role клиент, и тогда
 *   он же передается третьим аргументом, а выборку скоупит loadPortfolioAsAdmin.
 * @param admin service-role клиент: им пишутся snapshots/snapshot_items и
 *   обновляется общий кэш цен.
 *
 * Запись в два шага без транзакции (PostgREST их не дает):
 *  1. upsert строки снепшота по (user_id, taken_on) — повторный запуск за
 *     тот же день перезаписывает, а не дублирует (S3.1);
 *  2. upsert состава по (snapshot_id, category). Именно upsert, а не
 *     delete+insert: категории ровно три и всегда все три, поэтому мусора
 *     не остается, зато нет окна, в котором снепшот виден без состава.
 */
export async function createSnapshot(
  userSupabase: SupabaseClient,
  admin: SupabaseClient,
  userId: string,
  opts: CreateSnapshotOptions = {},
): Promise<CreateSnapshotResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const takenAt = new Date(nowMs).toISOString();
  // Календарный день в UTC — тот же пояс, что у расписания cron'а (03:00 UTC)
  const takenOn = takenAt.slice(0, 10);

  const readerScope = opts.readerScope ?? "rls";
  if (readerScope === "rls" && userSupabase === admin) {
    // Service-role клиент под видом пользовательского: RLS не сработает,
    // и в снепшот попал бы портфель ВСЕХ пользователей сразу
    throw new Error(
      'createSnapshot: service-role клиент требует readerScope: "admin"',
    );
  }

  const portfolio: LoadPortfolioResult =
    readerScope === "admin"
      ? await loadPortfolioAsAdmin(userSupabase, userId, {
          fetchIfExpired: opts.fetchIfExpired ?? true,
          nowMs,
        })
      : await loadPortfolio(userSupabase, userId, {
          admin,
          fetchIfExpired: opts.fetchIfExpired ?? true,
          nowMs,
        });

  const build = buildSnapshotRows(portfolio);

  const { data: snapshotRow, error: snapshotError } = await admin
    .from("snapshots")
    .upsert(
      {
        user_id: userId,
        taken_on: takenOn,
        taken_at: takenAt,
        total_usd: build.totalUsd,
        is_partial: build.isPartial,
      },
      { onConflict: "user_id,taken_on" },
    )
    .select("id, taken_on, taken_at, total_usd, is_partial")
    .single();
  if (snapshotError) throw new Error(`snapshots upsert: ${snapshotError.message}`);
  const snapshot = snapshotRow as SnapshotRow;

  const { error: itemsError } = await admin.from("snapshot_items").upsert(
    build.items.map((item) => ({
      snapshot_id: snapshot.id,
      category: item.category,
      quantity: item.quantity,
      price_usd: item.priceUsd,
      value_usd: item.valueUsd,
      percent: item.percent,
      collateral_usd: item.collateralUsd,
      manual_usd: item.manualUsd,
    })),
    { onConflict: "snapshot_id,category" },
  );
  if (itemsError) throw new Error(`snapshot_items upsert: ${itemsError.message}`);

  const items: SnapshotItemDto[] = build.items.map((item) => ({
    category: item.category,
    quantity: item.quantity,
    priceUsd: item.priceUsd,
    valueUsd: item.valueUsd,
    percent: item.percent,
    collateralUsd: item.collateralUsd,
    manualUsd: item.manualUsd,
  }));

  return {
    snapshot: {
      id: snapshot.id,
      takenOn: snapshot.taken_on,
      takenAt: snapshot.taken_at,
      totalUsd: Number(snapshot.total_usd),
      isPartial: snapshot.is_partial,
      items,
    },
    partialReasons: build.partialReasons,
  };
}

export interface WalletRefreshSummary {
  refreshed: number;
  failed: number;
  errors: string[];
}

/**
 * Обновление залога Aave по всем кошелькам пользователя перед снепшотом
 * (путь cron'а — сессии пользователя нет, поэтому service-role + явный
 * фильтр по user_id).
 *
 * Кошельки обрабатываются последовательно: параллельный веер по всем
 * пользователям упёрся бы в лимиты RPC-провайдера и в таймаут функции.
 * Упавший кошелек не отменяет снепшот — по S3.1 он снимается по последним
 * известным данным и помечается частичным.
 */
export async function refreshUserWallets(
  admin: SupabaseClient,
  userId: string,
): Promise<WalletRefreshSummary> {
  const { data: wallets, error } = await admin
    .from("wallets")
    .select("id, address")
    .eq("user_id", userId);
  if (error) throw new Error(`wallets: ${error.message}`);

  const summary: WalletRefreshSummary = { refreshed: 0, failed: 0, errors: [] };

  for (const wallet of wallets ?? []) {
    try {
      const statuses = await readWalletAaveCollateral(
        wallet.address as Address,
      );
      await persistAaveCollateral(admin, wallet.id as string, statuses);
      await persistChainStatus(admin, wallet.id as string, statuses);
      await admin
        .from("wallets")
        .update({ last_refreshed_at: new Date().toISOString() })
        .eq("id", wallet.id as string);
      summary.refreshed += 1;
    } catch (err) {
      summary.failed += 1;
      summary.errors.push(
        `${wallet.address}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return summary;
}
