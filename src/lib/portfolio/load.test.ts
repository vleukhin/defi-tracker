import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPortfolio, loadPortfolioAsAdmin } from "./load";

/**
 * Изоляция пользователей в admin-режиме (cron снимает снепшоты service-role
 * клиентом, RLS при этом не действует). Проверяется и то, что фильтр
 * поставлен, и то, что чужая строка не пролезет, даже если фильтр не сработал.
 */

const USER = "a580b020-6f69-471e-b25f-585d6c07a994";
const WALLET = "11111111-1111-4111-8111-111111111111";
const OTHER = "b0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-07-30T03:00:00.000Z");

interface RecordedQuery {
  table: string;
  filters: { op: string; column: string; value: unknown }[];
}

/** Минимальный двойник PostgREST-клиента: записывает фильтры, отдает фикстуры. */
function fakeClient(
  tables: Record<string, unknown[]>,
  recorded: RecordedQuery[],
): SupabaseClient {
  return {
    from(table: string) {
      const query: RecordedQuery = { table, filters: [] };
      recorded.push(query);
      const builder = {
        select: () => builder,
        order: () => builder,
        eq: (column: string, value: unknown) => {
          query.filters.push({ op: "eq", column, value });
          return builder;
        },
        in: (column: string, value: unknown) => {
          query.filters.push({ op: "in", column, value });
          return builder;
        },
        then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: tables[table] ?? [], error: null }).then(
            resolve,
          ),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

function fixtures(walletUserId = USER): Record<string, unknown[]> {
  return {
    wallets: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        user_id: walletUserId,
        address: "0x0000000000000000000000000000000000000001",
        label: null,
        last_refreshed_at: null,
      },
    ],
    protocol_positions: [
      {
        wallet_id: "11111111-1111-4111-8111-111111111111",
        chain: "arbitrum",
        quantity: "1",
        payload: { symbol: "WETH", category: "eth", coingeckoId: "weth" },
        updated_at: "2026-07-30T02:00:00.000Z",
      },
    ],
    manual_positions: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        user_id: USER,
        category: "stable",
        label: "Aave USDC",
        amount: "1000",
      },
    ],
    trades: [],
    portfolio_targets: [],
    chain_read_status: [
      {
        chain: "arbitrum",
        ok: true,
        error: null,
        checked_at: "2026-07-30T02:00:00.000Z",
      },
    ],
    coin_prices: [
      {
        coingecko_id: "bitcoin",
        price_usd: 100000,
        fetched_at: "2026-07-30T02:59:00.000Z",
      },
      {
        coingecko_id: "ethereum",
        price_usd: 4000,
        fetched_at: "2026-07-30T02:59:00.000Z",
      },
      {
        coingecko_id: "weth",
        price_usd: 4000,
        fetched_at: "2026-07-30T02:59:00.000Z",
      },
    ],
  };
}

function filterOn(
  recorded: RecordedQuery[],
  table: string,
): { op: string; column: string; value: unknown }[] {
  return recorded.filter((q) => q.table === table).flatMap((q) => q.filters);
}

describe("loadPortfolioAsAdmin: изоляция пользователя", () => {
  it("ставит user_id-фильтр на каждую пользовательскую таблицу", async () => {
    const recorded: RecordedQuery[] = [];
    const admin = fakeClient(fixtures(), recorded);

    const result = await loadPortfolioAsAdmin(admin, USER, { nowMs: NOW });

    for (const table of [
      "wallets",
      "manual_positions",
      "trades",
      "portfolio_targets",
      "deposits",
      // Разметка свободных средств: тоже user-scoped, и забыть про нее
      // в admin-режиме значило бы утащить чужие пометки в чужой снепшот
      "balance_marks",
    ]) {
      expect(
        filterOn(recorded, table),
        `таблица ${table} читается без фильтра по user_id`,
      ).toContainEqual({ op: "eq", column: "user_id", value: USER });
    }

    // Таблицы, привязанные к кошельку, скоупятся списком кошельков юзера
    for (const table of [
      "protocol_positions",
      "chain_read_status",
      "aave_account_health",
      "balances_cache",
    ]) {
      expect(
        filterOn(recorded, table).some(
          (f) =>
            f.op === "in" &&
            f.column === "wallet_id" &&
            Array.isArray(f.value) &&
            f.value.length === 1,
        ),
        `таблица ${table} читается без фильтра по кошелькам`,
      ).toBe(true);
    }

    // Данные при этом действительно собрались
    expect(result.totalUsd).toBeCloseTo(5000, 6);
  });

  it("падает, если в выборку попала строка другого пользователя", async () => {
    const recorded: RecordedQuery[] = [];
    // Двойник игнорирует фильтры — имитирует «фильтр не сработал»
    const admin = fakeClient(fixtures(OTHER), recorded);

    await expect(loadPortfolioAsAdmin(admin, USER, { nowMs: NOW })).rejects.toThrow(
      /чужого пользователя/,
    );
  });

  it("не принимает пустой или мусорный userId", async () => {
    const admin = fakeClient(fixtures(), []);

    await expect(loadPortfolioAsAdmin(admin, "", { nowMs: NOW })).rejects.toThrow(
      /невалидный userId/,
    );
    await expect(
      loadPortfolioAsAdmin(admin, "все", { nowMs: NOW }),
    ).rejects.toThrow(/невалидный userId/);
  });

  it("свободные балансы собираются: сырое значение, символ, разметка", async () => {
    const recorded: RecordedQuery[] = [];
    const data = fixtures();
    data.balances_cache = [
      {
        wallet_id: WALLET,
        asset_id: "aaaa1111-0000-4000-8000-000000000001",
        // 20 000 USDC при 6 decimals; строкой — как отдает raw_amount::text
        raw_amount: "20000000000",
        updated_at: "2026-07-30T02:30:00.000Z",
      },
      {
        wallet_id: WALLET,
        asset_id: "aaaa1111-0000-4000-8000-000000000002",
        // 1e21 wei = 1000 ETH: без каста в text PostgREST вернул бы "1e+21"
        raw_amount: "1e+21",
        updated_at: "2026-07-30T02:30:00.000Z",
      },
    ];
    data.assets = [
      {
        id: "aaaa1111-0000-4000-8000-000000000001",
        chain: "arbitrum",
        contract_address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        symbol: "USDC",
        decimals: 6,
        coingecko_id: "usd-coin",
      },
      {
        id: "aaaa1111-0000-4000-8000-000000000002",
        chain: "arbitrum",
        contract_address: null,
        symbol: "ETH",
        decimals: 18,
        coingecko_id: "ethereum",
      },
    ];
    data.balance_marks = [
      {
        user_id: USER,
        wallet_id: WALLET,
        chain: "arbitrum",
        token: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        funds: "borrowed",
      },
    ];

    const result = await loadPortfolioAsAdmin(fakeClient(data, recorded), USER, {
      nowMs: NOW,
    });

    const stable = result.rows.find((r) => r.category === "stable")!;
    const eth = result.rows.find((r) => r.category === "eth")!;
    // Заемные USDC: в категории нет, но в списке и в Активах есть
    expect(stable.breakdown.freeUsd).toBe(0);
    expect(stable.freeBalances[0]).toMatchObject({
      symbol: "USDC",
      quantity: "20000",
      valueUsd: 20_000,
      funds: "borrowed",
      countedInCategory: false,
    });
    expect(result.freeBorrowedUsd).toBe(20_000);
    // Нативный ETH: экспоненциальная запись развернулась, а не уронила разбор
    expect(eth.freeBalances[0]).toMatchObject({
      symbol: "ETH",
      token: "native",
      quantity: "1000",
      funds: null,
    });
    expect(result.unmarkedFreeCount).toBe(1);
  });

  it("обычный путь (RLS) фильтр по user_id не ставит", async () => {
    const recorded: RecordedQuery[] = [];
    const supabase = fakeClient(fixtures(), recorded);

    await loadPortfolio(supabase, USER, { admin: supabase, nowMs: NOW });

    const userIdFilters = recorded
      .flatMap((q) => q.filters)
      .filter((f) => f.column === "user_id");
    expect(userIdFilters).toEqual([]);
  });
});
