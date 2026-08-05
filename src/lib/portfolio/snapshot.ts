import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Address } from "viem";
import {
  persistAaveCollateral,
  persistChainStatus,
  readWalletAaveCollateral,
} from "@/lib/chains/aave";
import {
  persistAaveDebt,
  persistAaveHealth,
  persistDebtStatus,
  readWalletAaveDebt,
} from "@/lib/chains/aave-debt";
import {
  persistFluidPositions,
  persistFluidStatus,
  readWalletFluid,
} from "@/lib/chains/fluid";
import {
  persistGmxPositions,
  persistGmxStatus,
  readWalletGmx,
} from "@/lib/chains/gmx";
import {
  persistUniswapV3Positions,
  persistUniswapV3Status,
  readWalletUniswapV3,
} from "@/lib/chains/uniswap-v3";
import {
  persistBalanceStatus,
  persistBalances,
  readWalletBalances,
} from "@/lib/chains/reader";
import type { FundsMark, SnapshotDto, SnapshotItemDto } from "@/lib/api/types";
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
  /**
   * Долг на момент съема (Фаза 4). Поля опциональны: снепшот собирается
   * и без данных долга — тогда debt_usd пишется как null («не известно»).
   */
  hasWallets?: boolean;
  debtUsd?: number | null;
  /** Статус чтения долга/HF по сетям (source = aave_v3_debt). */
  debtChains?: ChainStatusRow[];
  /**
   * Вклад размещенных позиций в Активы на момент съема (Фаза 5).
   * Пишется по той же причине, что и debtUsd: стоимость GM-пула или LP
   * на прошлую дату задним числом не восстановить — ни оракул GMX, ни тик
   * пула в прошлом нам недоступны.
   */
  positionsUsd?: number | null;
  /** Статус чтения свободных балансов по сетям (source = erc20, Фаза 7). */
  freeChains?: ChainStatusRow[];
  /**
   * Свободные ЗАЕМНЫЕ средства на момент съема. В категории не входят,
   * поэтому в сумму items их не найти, а Активы точки без них не сходятся.
   */
  freeBorrowedUsd?: number;
}

/**
 * Сырой состав категории: количества монет, не зависящие от цен.
 *
 * quantity в SnapshotItemInput — производная (стоимость / цена категории),
 * и при отсутствии цены она null. Доллары на прошлую дату восстановимы из
 * исторической цены, количество монет — нет, поэтому пишем и его.
 */
export interface SnapshotComposition {
  collateral: { symbol: string; chain: string; quantity: string }[];
  manual: { label: string; amount: string }[];
  /**
   * Свободные средства на кошельках (Фаза 7). Необязательное поле: точки,
   * снятые до чтения балансов, о них не знали, и пустой массив в них был бы
   * враньем — «свободных не было» вместо «мы их не видели».
   *
   * funds пишется вместе с количеством: разметку «свои/заемные» на прошлую
   * дату не восстановить вообще ничем — она перезаписывается на месте.
   */
  free?: {
    symbol: string;
    chain: string;
    quantity: string;
    funds: FundsMark | null;
  }[];
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
  /** Свободные средства категории (только вошедшие в нее — не заемные). */
  freeUsd: number;
  /** Сырые количества — единственное, что нельзя восстановить задним числом. */
  composition: SnapshotComposition;
}

export interface SnapshotBuild {
  totalUsd: number;
  /** Долг на момент съема; null = неизвестен (невосстановим задним числом). */
  debtUsd: number | null;
  /** Размещенные позиции на момент съема; null = стоимость неизвестна. */
  positionsUsd: number | null;
  /**
   * Свободные средства на момент съема: свои и неразмеченные, вошедшие
   * в категории. null = балансы еще ни разу не читались — ноль здесь означал
   * бы «свободных не было» и сделал бы ступеньку в total_usd необъяснимой.
   */
  freeUsd: number | null;
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
 *  4. (Фаза 4) Чтение долга/HF по любой сети не удалось, либо кошельки есть,
 *     а долг не читался ни разу: debt_usd в такой точке опирается на
 *     устаревший кэш или отсутствует, и это должно быть видно.
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

  // Долг (Фаза 4): упавшее чтение или полное отсутствие данных при наличии
  // кошельков делает debt_usd точки заведомо неточным — помечаем честно
  const debtChains = portfolio.debtChains ?? [];
  for (const chain of debtChains) {
    if (!chain.ok) {
      partialReasons.push(
        `долг: сеть ${chain.chain} недоступна${chain.error ? `: ${chain.error}` : ""}`,
      );
    }
  }
  if (portfolio.hasWallets && debtChains.length === 0) {
    partialReasons.push("долг ни разу не прочитан");
  }

  // Свободные средства (Фаза 7): упавшая сеть оставляет в кэше вчерашние
  // балансы, и точка истории опирается на них. Отсутствие статуса вообще
  // частичности НЕ дает: балансы могли еще ни разу не читаться — это не
  // неполные данные, а их осознанное отсутствие в старых снепшотах
  for (const chain of portfolio.freeChains ?? []) {
    if (!chain.ok) {
      partialReasons.push(
        `свободные средства: сеть ${chain.chain} недоступна${chain.error ? `: ${chain.error}` : ""}`,
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
      freeUsd: row.breakdown.freeUsd,
      // Сырые количества пишутся ВСЕГДА, даже когда цены нет и
      // quantity === null: счетчик монет за день не должен теряться
      composition: {
        collateral: row.collateralDetail.map((c) => ({
          symbol: c.symbol,
          chain: c.chain,
          quantity: c.quantity,
        })),
        manual: row.manualEntries.map((m) => ({
          label: m.label,
          amount: m.amount,
        })),
        // Заемные тоже пишутся: состав должен отвечать на вопрос «что лежало
        // на кошельке», а не только «что попало в категорию»
        free: row.freeBalances.map((b) => ({
          symbol: b.symbol,
          chain: b.chain,
          quantity: b.quantity,
          funds: b.funds,
        })),
      },
    };
  });

  // Позиции (Фаза 5): неизвестная стоимость размещенных средств делает
  // точку неполной так же, как неизвестный долг — Активы в ней занижены
  if (portfolio.positionsUsd === null) {
    partialReasons.push("стоимость размещенных позиций неизвестна");
  }

  return {
    totalUsd: portfolio.totalUsd,
    debtUsd: portfolio.debtUsd ?? null,
    positionsUsd: portfolio.positionsUsd ?? null,
    // Балансы ни разу не читались — null, а не ноль (см. миграцию). Ровно
    // та же развилка, что у долга в computeOverview: кошельков нет — свободных
    // средств честно ноль; кошельки есть, а чтения не было — неизвестно
    freeUsd:
      portfolio.hasWallets && (portfolio.freeChains ?? []).length === 0
        ? null
        : items.reduce((sum, i) => sum + i.freeUsd, 0),
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
  debt_usd: number | string | null;
  positions_usd: number | string | null;
  free_usd: number | string | null;
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

  const build = buildSnapshotRows({
    ...portfolio,
    hasWallets: portfolio.wallets.length > 0,
    // Долг из кэша aave_account_health (Aave-оракул); null = не читался
    debtUsd: portfolio.overview.debtUsd,
    // Размещенные позиции (Фаза 5) — вторая половина Активов
    positionsUsd: portfolio.overview.positionsUsd,
    // Свободные средства (Фаза 7): свой контур чтения — свой статус сетей
    freeChains: portfolio.freeChains,
    freeBorrowedUsd: portfolio.overview.freeBorrowedUsd,
  });

  const { data: snapshotRow, error: snapshotError } = await admin
    .from("snapshots")
    .upsert(
      {
        user_id: userId,
        taken_on: takenOn,
        taken_at: takenAt,
        total_usd: build.totalUsd,
        debt_usd: build.debtUsd,
        positions_usd: build.positionsUsd,
        free_usd: build.freeUsd,
        is_partial: build.isPartial,
      },
      { onConflict: "user_id,taken_on" },
    )
    .select(
      "id, taken_on, taken_at, total_usd, debt_usd, positions_usd, free_usd, is_partial",
    )
    .single();
  if (snapshotError) throw new Error(`snapshots upsert: ${snapshotError.message}`);
  const snapshot = snapshotRow as SnapshotRow;

  const { error: itemsError } = await admin.from("snapshot_items").upsert(
    build.items.map((item) => ({
      snapshot_id: snapshot.id,
      category: item.category,
      quantity: item.quantity,
      composition: item.composition,
      price_usd: item.priceUsd,
      value_usd: item.valueUsd,
      percent: item.percent,
      collateral_usd: item.collateralUsd,
      manual_usd: item.manualUsd,
      free_usd: item.freeUsd,
    })),
    { onConflict: "snapshot_id,category" },
  );
  if (itemsError) throw new Error(`snapshot_items upsert: ${itemsError.message}`);

  const items: SnapshotItemDto[] = build.items.map((item) => ({
    category: item.category,
    quantity: item.quantity,
    composition: item.composition,
    priceUsd: item.priceUsd,
    valueUsd: item.valueUsd,
    percent: item.percent,
    collateralUsd: item.collateralUsd,
    manualUsd: item.manualUsd,
    freeUsd: item.freeUsd,
  }));

  return {
    snapshot: {
      id: snapshot.id,
      takenOn: snapshot.taken_on,
      takenAt: snapshot.taken_at,
      totalUsd: Number(snapshot.total_usd),
      debtUsd: snapshot.debt_usd === null ? null : Number(snapshot.debt_usd),
      positionsUsd:
        snapshot.positions_usd === null ? null : Number(snapshot.positions_usd),
      freeUsd: snapshot.free_usd === null ? null : Number(snapshot.free_usd),
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

      // Долг и HF (Фаза 4): дневной снепшот должен видеть свежий долг —
      // задним числом getUserAccountData не восстановим
      const debtStatuses = await readWalletAaveDebt(wallet.address as Address);
      await persistAaveHealth(admin, wallet.id as string, debtStatuses);
      await persistAaveDebt(admin, wallet.id as string, debtStatuses);
      await persistDebtStatus(admin, wallet.id as string, debtStatuses);

      // Размещение заемных средств (Фаза 5). Каждый протокол в своем
      // try/catch: недоступность GMX API не должна лишать снепшот депозитов
      // Fluid — и уж тем более не должна ронять обновление кошелька целиком.
      try {
        const fluidStatuses = await readWalletFluid(wallet.address as Address);
        await persistFluidPositions(admin, wallet.id as string, fluidStatuses);
        await persistFluidStatus(admin, wallet.id as string, fluidStatuses);
      } catch (err) {
        console.warn(`[snapshot] Fluid ${wallet.address}:`, err);
      }
      try {
        const gmxStatus = await readWalletGmx(wallet.address as Address);
        await persistGmxPositions(admin, wallet.id as string, gmxStatus);
        await persistGmxStatus(admin, wallet.id as string, gmxStatus);
      } catch (err) {
        console.warn(`[snapshot] GM-пулы ${wallet.address}:`, err);
      }
      try {
        const lpStatuses = await readWalletUniswapV3(wallet.address as Address);
        await persistUniswapV3Positions(admin, wallet.id as string, lpStatuses);
        await persistUniswapV3Status(admin, wallet.id as string, lpStatuses);
      } catch (err) {
        console.warn(`[snapshot] LP-позиции ${wallet.address}:`, err);
      }
      // Свободные средства кошелька (Фаза 7). Последними: контуры идут
      // последовательно, а баланс на прошлую дату задним числом уже
      // не восстановить — но залог, долг и позиции важнее.
      try {
        const balanceStatuses = await readWalletBalances(
          wallet.address as Address,
        );
        await persistBalances(admin, wallet.id as string, balanceStatuses);
        await persistBalanceStatus(admin, wallet.id as string, balanceStatuses);
      } catch (err) {
        console.warn(`[snapshot] балансы ${wallet.address}:`, err);
      }

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
