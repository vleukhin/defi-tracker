import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AAVE_PROTOCOL, type AavePositionPayload } from "@/lib/chains/aave";
import { AAVE_DEBT_SOURCE } from "@/lib/chains/aave-debt";
import type {
  PortfolioOverviewDto,
  PositionDto,
  PositionsSummaryDto,
  StrategyZone,
  ZonesSummaryDto,
} from "@/lib/api/types";
import {
  POSITION_PROTOCOLS,
  buildPositions,
  positionPriceIds,
  zoneKeyOf,
  type PositionMark,
  type PositionRowInput,
} from "@/lib/positions/positions";
import { buildZones, type ManualAtom } from "@/lib/positions/zones";
import { computeOverview } from "./overview";
import {
  CATEGORY_COINGECKO_IDS,
  STABLE_PRICE_USD,
  getCoinPrices,
} from "@/lib/prices/coins";
import {
  buildLedgerRowInfo,
  replayTrades,
  type LedgerRowInfo,
  type LedgerTrade,
} from "./ledger";
import {
  computePortfolio,
  type CollateralInput,
  type ManualInput,
  type PortfolioCategory,
  type PortfolioResult,
  type PortfolioRow,
} from "./portfolio";

/**
 * Сборка входных данных портфеля из БД и вызов движка.
 *
 * Два входа:
 *  * loadPortfolio(userSupabase, userId) — обычный путь: выборку режет RLS;
 *  * loadPortfolioAsAdmin(admin, userId) — путь cron'а: сессии пользователя
 *    на сервере нет, поэтому читает service-role клиент, RLS обойдена и
 *    фильтр по user_id ставится ЯВНО в каждом запросе (+ пост-проверка
 *    принадлежности строк, см. assertOwned).
 *
 * Цены в обоих случаях — общий кэш coin_prices через service-role.
 */

/** z.guid()-совместимая проверка: любой UUID, без требования версии. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WalletRow {
  id: string;
  user_id: string;
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

/** Строка портфеля + блок леджера сделок (Фаза 2, S2.2). */
export interface PortfolioRowWithLedger extends PortfolioRow {
  ledger: LedgerRowInfo;
}

export interface LoadPortfolioResult extends Omit<PortfolioResult, "rows"> {
  rows: PortfolioRowWithLedger[];
  wallets: WalletRow[];
  /** Статус последнего чтения залога по сетям (агрегировано по кошелькам). */
  chains: ChainStatusRow[];
  /** Статус последнего чтения долга/HF (source = aave_v3_debt, Фаза 4). */
  debtChains: ChainStatusRow[];
  /** Связка пяти чисел: Активы · Долг · Чистая · Внесено · Прибыль (S4.2). */
  overview: PortfolioOverviewDto;
  /** Размещенные позиции (Фаза 5): Fluid, GM-пулы, LP. */
  positions: PositionDto[];
  /** Вклад позиций в Активы и учет собственного капитала внутри них. */
  positionsSummary: PositionsSummaryDto;
  /** Разрез по зонам стратегии Capital Growth (Фаза 6). */
  zones: ZonesSummaryDto;
  oldestCollateralAt: string | null;
}

export interface LoadOptions {
  /** true = дотянуть истекшие цены (refresh); false = только кэш (дашборд). */
  fetchIfExpired?: boolean;
  nowMs?: number;
  /** Service-role клиент для кэша цен; по умолчанию создается свой. */
  admin?: SupabaseClient;
  /**
   * true = supabase создан service-role ключом (RLS не действует), фильтр
   * по user_id обязателен. Не выставляется снаружи — только через
   * loadPortfolioAsAdmin.
   */
  explicitUserFilter?: boolean;
}

/**
 * Портфель пользователя по его же клиенту: строки режет RLS.
 */
export async function loadPortfolio(
  supabase: SupabaseClient,
  userId: string,
  opts: LoadOptions = {},
): Promise<LoadPortfolioResult> {
  const explicit = opts.explicitUserFilter === true;
  if (explicit && !UUID_RE.test(userId)) {
    // Пустой/мусорный userId в admin-режиме означал бы выборку по всем
    // пользователям — падаем громко, а не отдаем чужие данные
    throw new Error("loadPortfolio: невалидный userId для admin-режима");
  }

  /**
   * Явный фильтр по владельцу — только когда RLS обойдена.
   * Приведение внутри, а не констрейнт на T: рекурсивные типы PostgREST
   * при инференсе через `T extends { eq(...): T }` упираются в TS2589.
   */
  const scopeUser = <T>(query: T): T =>
    explicit
      ? (query as { eq(column: string, value: string): T }).eq(
          "user_id",
          userId,
        )
      : query;

  /**
   * Пост-проверка: даже если фильтр где-то забыли или PostgREST повел себя
   * неожиданно, чужая строка не попадет в снепшот. Дешево (строк единицы),
   * а цена ошибки — утечка данных другого пользователя в чужую историю.
   */
  const assertOwned = (rows: { user_id?: string }[], table: string): void => {
    if (!explicit) return;
    for (const row of rows) {
      if (row.user_id !== userId) {
        throw new Error(`${table}: строка чужого пользователя в admin-режиме`);
      }
    }
  };

  const { data: walletRows, error: walletsError } = await scopeUser(
    supabase
      .from("wallets")
      .select("id, user_id, address, label, last_refreshed_at"),
  ).order("created_at", { ascending: true });
  if (walletsError) throw new Error(`wallets: ${walletsError.message}`);
  assertOwned((walletRows ?? []) as { user_id?: string }[], "wallets");
  const wallets = (walletRows ?? []) as WalletRow[];
  const walletById = new Map(wallets.map((w) => [w.id, w]));
  const walletIds = wallets.map((w) => w.id);

  // --- Залог Aave ---
  const collateral: CollateralInput[] = [];
  let oldestCollateralAt: string | null = null;
  if (wallets.length > 0) {
    // Фильтр по кошелькам пользователя — не только для admin-режима: под RLS
    // он избыточен, но делает выборку одинаковой на обоих путях
    const { data: positions, error: positionsError } = await supabase
      .from("protocol_positions")
      .select("wallet_id, chain, quantity, payload, updated_at")
      .eq("protocol", AAVE_PROTOCOL)
      .in("wallet_id", walletIds);
    if (positionsError)
      throw new Error(`protocol_positions: ${positionsError.message}`);

    for (const row of positions ?? []) {
      const payload = row.payload as
        | (AavePositionPayload & { kind?: string })
        | null;
      // Долговые строки (payload.kind = 'debt', Фаза 4) — отдельный контур:
      // в категории и знаменатель портфеля они не входят никогда
      if (payload?.kind === "debt") continue;
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
  const { data: manualRows, error: manualError } = await scopeUser(
    supabase
      .from("manual_positions")
      .select("id, user_id, category, label, amount, zone"),
  ).order("created_at", { ascending: true });
  if (manualError) throw new Error(`manual_positions: ${manualError.message}`);
  assertOwned((manualRows ?? []) as { user_id?: string }[], "manual_positions");
  const manual: ManualInput[] = (manualRows ?? []).map((r) => ({
    id: r.id as string,
    category: r.category as PortfolioCategory,
    label: r.label as string,
    amount: String(r.amount),
  }));
  // Зона ручной записи: NULL = не размечена, выводится из категории
  const manualZones = new Map<string, StrategyZone | null>(
    (manualRows ?? []).map((r) => [
      r.id as string,
      (r.zone as StrategyZone | null) ?? null,
    ]),
  );

  // --- Сделки (Фаза 2): реплей леджера для средней цены и P/L ---
  const { data: tradeRows, error: tradesError } = await scopeUser(
    supabase
      .from("trades")
      .select(
        "user_id, category, side, quantity, price_usd, traded_at, created_at",
      ),
  );
  if (tradesError) throw new Error(`trades: ${tradesError.message}`);
  assertOwned((tradeRows ?? []) as { user_id?: string }[], "trades");
  const ledgerTrades: LedgerTrade[] = (tradeRows ?? []).map((r) => ({
    category: r.category as PortfolioCategory,
    side: r.side as LedgerTrade["side"],
    quantity: String(r.quantity),
    priceUsd: String(r.price_usd),
    tradedAt: r.traded_at as string,
    createdAt: r.created_at as string,
  }));

  // --- Цели ---
  const { data: targetRows, error: targetsError } = await scopeUser(
    supabase.from("portfolio_targets").select("user_id, category, target_pct"),
  );
  if (targetsError)
    throw new Error(`portfolio_targets: ${targetsError.message}`);
  assertOwned(
    (targetRows ?? []) as { user_id?: string }[],
    "portfolio_targets",
  );
  const targets: Partial<Record<PortfolioCategory, number>> = {};
  for (const row of targetRows ?? []) {
    targets[row.category as PortfolioCategory] = Number(row.target_pct);
  }

  // --- «Внесено» (Фаза 4, S4.0): подписанная сумма журнала deposits ---
  const { data: depositRows, error: depositsError } = await scopeUser(
    supabase.from("deposits").select("user_id, amount"),
  );
  if (depositsError) throw new Error(`deposits: ${depositsError.message}`);
  assertOwned((depositRows ?? []) as { user_id?: string }[], "deposits");
  const depositedUsd = (depositRows ?? []).reduce(
    (sum, r) => sum + Number(r.amount),
    0,
  );

  // --- Долг (Фаза 4): канонические totals из aave_account_health.
  // Wallet-scoped (как protocol_positions): под RLS фильтр избыточен,
  // но делает выборку одинаковой на обоих путях ---
  const healthRows: { totalDebtUsd: number | null }[] = [];
  if (wallets.length > 0) {
    const { data: health, error: healthError } = await supabase
      .from("aave_account_health")
      .select("wallet_id, chain, total_debt_usd")
      .in("wallet_id", walletIds);
    if (healthError)
      throw new Error(`aave_account_health: ${healthError.message}`);
    for (const row of health ?? []) {
      healthRows.push({
        totalDebtUsd:
          row.total_debt_usd === null ? null : Number(row.total_debt_usd),
      });
    }
  }

  // --- Размещенные позиции (Фаза 5): Fluid, GM-пулы, LP ---
  const positionRows: PositionRowInput[] = [];
  if (wallets.length > 0) {
    const { data: rows, error: rowsError } = await supabase
      .from("protocol_positions")
      .select("id, wallet_id, protocol, chain, external_id, quantity, value_usd, payload, updated_at")
      .in("protocol", POSITION_PROTOCOLS)
      .in("wallet_id", walletIds);
    if (rowsError)
      throw new Error(`protocol_positions (позиции): ${rowsError.message}`);
    for (const row of rows ?? []) {
      const wallet = walletById.get(row.wallet_id as string);
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
        walletLabel: wallet?.label ?? null,
      });
    }
  }

  // --- Разметка позиций (Фаза 6): зона и доля собственных средств.
  // Живет отдельно от строк читателя и адресуется натуральным ключом —
  // при перезаливке диапазона CLMM выдает новый tokenId ---
  const { data: markRows, error: marksError } = await scopeUser(
    supabase
      .from("position_marks")
      .select("user_id, protocol, chain, external_id, zone, own_principal_usd, borrowed_principal_usd"),
  );
  if (marksError) throw new Error(`position_marks: ${marksError.message}`);
  assertOwned((markRows ?? []) as { user_id?: string }[], "position_marks");
  const marksByKey = new Map<string, PositionMark>(
    (markRows ?? []).map((r) => [
      zoneKeyOf({
        protocol: r.protocol as string,
        chain: r.chain as string,
        externalId: r.external_id as string,
      }),
      {
        zone: (r.zone as StrategyZone | null) ?? null,
        // NULL = не размечено, и это не ноль
        ownPrincipalUsd:
          r.own_principal_usd === null ? null : Number(r.own_principal_usd),
        borrowedPrincipalUsd:
          r.borrowed_principal_usd === null
            ? null
            : Number(r.borrowed_principal_usd),
      } satisfies PositionMark,
    ]),
  );

  // --- Цены: категории, залоговые токены и компоненты позиций ---
  const priceIds = [
    CATEGORY_COINGECKO_IDS.btc,
    CATEGORY_COINGECKO_IDS.eth,
    ...collateral.map((c) => c.coingeckoId),
    ...positionPriceIds(positionRows),
  ];
  const prices = await getCoinPrices(priceIds, {
    admin: opts.admin,
    fetchIfExpired: opts.fetchIfExpired ?? false,
    nowMs: opts.nowMs,
  });

  // Позиции считаются ДО портфеля: их собственные доли и образуют
  // категорию «Стейблы» (по стратегии свои стейблы всегда лежат в позициях)
  const pricesUsd = new Map(
    [...prices.entries()].map(([id, p]) => [id, p.priceUsd]),
  );
  const positions = buildPositions({
    rows: positionRows,
    pricesUsd,
    marksByKey,
  });

  // Синтетические записи категории «Стейблы» из собственных долей позиций.
  // Префикс pos: отличает их от настоящих ручных записей — в зонах позиция
  // уже учтена целиком, и второй раз считать ее нельзя.
  const ownEntries: ManualInput[] = positions.positions
    .filter((p) => (p.ownCurrentUsd ?? 0) > 0)
    .map((p) => ({
      id: `pos:${p.zoneKey}`,
      category: "stable" as PortfolioCategory,
      label: `${p.title} · ${p.protocolLabel}`,
      amount: String(p.ownCurrentUsd),
    }));

  const result = computePortfolio({
    collateral,
    manual: [...manual, ...ownEntries],
    targets,
    prices,
    stablePriceUsd: STABLE_PRICE_USD,
    categoryIds: CATEGORY_COINGECKO_IDS,
  });

  // Unrealized P/L и расхождение леджер/факт — здесь, где известны текущая
  // цена категории (row.price) и фактическое количество (row.amount)
  const ledger = replayTrades(ledgerTrades);
  const rows: PortfolioRowWithLedger[] = result.rows.map((row) => ({
    ...row,
    ledger: buildLedgerRowInfo(ledger[row.category], {
      currentPriceUsd: row.price,
      actualQty: row.amount,
    }),
  }));

  // --- Статус чтения сетей: сеть считается деградировавшей, если упала
  // хотя бы по одному кошельку (данные портфеля в этом случае неполные).
  // Источники раздельные: залог (aave_v3) и долг/HF (aave_v3_debt) ---
  const chains: ChainStatusRow[] = [];
  const debtChains: ChainStatusRow[] = [];
  if (wallets.length > 0) {
    const { data: statusRows, error: statusError } = await supabase
      .from("chain_read_status")
      .select("source, chain, ok, error, checked_at")
      .in("source", [AAVE_PROTOCOL, AAVE_DEBT_SOURCE])
      .in("wallet_id", walletIds);
    if (statusError)
      throw new Error(`chain_read_status: ${statusError.message}`);

    const bySourceChain = new Map<string, ChainStatusRow>();
    for (const row of statusRows ?? []) {
      const key = `${row.source}:${row.chain}`;
      const current = bySourceChain.get(key);
      const next: ChainStatusRow = {
        chain: row.chain as string,
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
        bySourceChain.set(key, next);
      }
    }
    for (const [key, status] of bySourceChain) {
      (key.startsWith(`${AAVE_DEBT_SOURCE}:`) ? debtChains : chains).push(
        status,
      );
    }
  }

  // --- Зоны стратегии (Фаза 6). Считаются по атомам, поэтому сумма зон
  // сходится с «Активами»: залог + свободные стейблы + позиции ЦЕЛИКОМ.
  // Синтетические записи (pos:) исключаются — позиция уже учтена полностью,
  // и второй раз ее собственная доля в зонах появиться не должна ---
  const manualAtoms: ManualAtom[] = result.rows.flatMap((row) =>
    row.manualEntries
      .filter((e) => !e.id.startsWith("pos:"))
      .map((e) => ({
        id: e.id,
        category: row.category,
        label: e.label,
        valueUsd: e.valueUsd,
        zone: manualZones.get(e.id) ?? null,
      })),
  );
  const zones = buildZones({
    collateral: result.rows.flatMap((row) =>
      row.collateralDetail.map((c) => ({
        category: row.category,
        valueUsd: c.valueUsd,
      })),
    ),
    manual: manualAtoms,
    positions: positions.positions.map((p) => ({
      id: p.id,
      protocol: p.protocol,
      title: p.title,
      valueUsd: p.valueUsd,
      zone: p.zone,
      ownUsd: p.ownCurrentUsd,
    })),
  });

  const overview = computeOverview({
    portfolioUsd: result.totalUsd,
    positionsUsd: positions.summary.positionsUsd,
    hasWallets: wallets.length > 0,
    healthRows,
    depositedUsd,
  });

  return {
    ...result,
    rows,
    wallets,
    chains,
    debtChains,
    overview,
    positions: positions.positions,
    positionsSummary: positions.summary,
    zones,
    oldestCollateralAt,
  };
}

/**
 * Портфель конкретного пользователя по service-role клиенту (cron-снепшоты).
 *
 * У cron'а нет пользовательской сессии, а значит и RLS-клиента: единственный
 * доступный путь — service-role. Изоляция здесь держится не на базе, а на коде,
 * поэтому она двойная: явный `.eq("user_id", ...)` в каждом запросе плюс
 * проверка принадлежности каждой полученной строки (assertOwned внутри).
 * Никогда не вызывать этот вход из роутов, обслуживающих браузер.
 */
export async function loadPortfolioAsAdmin(
  admin: SupabaseClient,
  userId: string,
  opts: Omit<LoadOptions, "explicitUserFilter" | "admin"> = {},
): Promise<LoadPortfolioResult> {
  return loadPortfolio(admin, userId, {
    ...opts,
    admin,
    explicitUserFilter: true,
  });
}
