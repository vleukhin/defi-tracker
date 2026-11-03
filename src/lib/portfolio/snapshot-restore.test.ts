import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSnapshot } from "./snapshot";
import type { ChainSource } from "./load";

/**
 * Снятие точки за ПРОШЛУЮ дату (scripts/restore-snapshot.ts).
 *
 * Две вещи, цена ошибки в которых — испорченная история: предпросмотр не
 * должен писать ничего, а подменённый источник не должен молча оказаться
 * проигнорированным — иначе в строку с прошлой датой уедет сегодняшнее
 * состояние, и отличить подделку от измерения будет уже нечем.
 */

const USER = "a580b020-6f69-471e-b25f-585d6c07a994";
const WALLET = "11111111-1111-4111-8111-111111111111";
const BLOCK_TIME = "2026-10-26T03:00:00.000Z";
const TARGET_MS = Date.parse(BLOCK_TIME);

interface Write {
  table: string;
  rows: unknown;
}

function fakeAdmin(writes: Write[]): SupabaseClient {
  const tables: Record<string, unknown[]> = {
    wallets: [
      {
        id: WALLET,
        user_id: USER,
        address: "0x0000000000000000000000000000000000000001",
        label: null,
        last_refreshed_at: null,
      },
    ],
    manual_positions: [],
    trades: [],
    portfolio_targets: [],
    deposits: [],
    balance_marks: [],
    coin_prices: [],
  };

  const makeBuilder = (table: string) => {
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: () => builder,
      in: () => builder,
      single: async () => ({
        data: { id: "snapshot-id", ...(writes.at(-1)?.rows as object) },
        error: null,
      }),
      upsert: (rows: unknown) => {
        writes.push({ table, rows });
        return builder;
      },
      then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve),
    };
    return builder;
  };

  return { from: (table: string) => makeBuilder(table) } as unknown as SupabaseClient;
}

function chainSource(): ChainSource {
  return {
    collateral: [
      {
        walletId: WALLET,
        walletLabel: null,
        chain: "arbitrum",
        symbol: "WETH",
        category: "eth",
        coingeckoId: "weth",
        quantity: "2",
      },
    ],
    stableDebt: [],
    healthRows: [
      { totalDebtUsd: 1000, totalCollateralUsd: 8000, healthFactor: 2.5 },
    ],
    positionRows: [],
    free: [],
    chains: [{ chain: "arbitrum", ok: true, error: null, checked_at: BLOCK_TIME }],
    debtChains: [
      { chain: "arbitrum", ok: true, error: null, checked_at: BLOCK_TIME },
    ],
    freeChains: [
      { chain: "arbitrum", ok: true, error: null, checked_at: BLOCK_TIME },
    ],
    oldestCollateralAt: BLOCK_TIME,
    loadPrices: async (ids) =>
      new Map(
        ids.map((id) => [id, { priceUsd: 2000, fetchedAt: BLOCK_TIME, stale: false }]),
      ),
  };
}

describe("createSnapshot: восстановление прошлой точки", () => {
  it("dryRun не пишет ни строки", async () => {
    const writes: Write[] = [];
    const admin = fakeAdmin(writes);

    const { snapshot } = await createSnapshot(admin, admin, USER, {
      readerScope: "admin",
      chainSource: chainSource(),
      nowMs: TARGET_MS,
      dryRun: true,
    });

    expect(writes).toEqual([]);
    // Но точка собрана целиком — иначе предпросмотр не на что смотреть
    expect(snapshot.takenOn).toBe("2026-10-26");
    expect(snapshot.totalUsd).toBeCloseTo(4000, 6);
    expect(snapshot.debtUsd).toBe(1000);
  });

  it("ставит точку на дату момента, а не на сегодня", async () => {
    const writes: Write[] = [];
    const admin = fakeAdmin(writes);

    await createSnapshot(admin, admin, USER, {
      readerScope: "admin",
      chainSource: chainSource(),
      nowMs: TARGET_MS,
    });

    const snapshotWrite = writes.find((w) => w.table === "snapshots");
    expect(snapshotWrite?.rows).toMatchObject({
      taken_on: "2026-10-26",
      taken_at: BLOCK_TIME,
      user_id: USER,
    });
    expect(writes.some((w) => w.table === "snapshot_items")).toBe(true);
  });

  it("отказывается принимать источник без admin-скоупа", async () => {
    // Тихо проигнорировать chainSource значило бы записать СЕГОДНЯШНЕЕ
    // состояние в строку с прошлой датой — порча, которую нечем заметить
    const admin = fakeAdmin([]);

    await expect(
      createSnapshot(admin, admin, USER, {
        chainSource: chainSource(),
        nowMs: TARGET_MS,
      }),
    ).rejects.toThrow(/readerScope/);
  });

  it("предпросмотр и запись дают одну и ту же точку", async () => {
    const writes: Write[] = [];
    const admin = fakeAdmin(writes);
    const opts = {
      readerScope: "admin" as const,
      chainSource: chainSource(),
      nowMs: TARGET_MS,
    };

    const preview = await createSnapshot(admin, admin, USER, {
      ...opts,
      dryRun: true,
    });
    const written = await createSnapshot(admin, admin, USER, opts);

    expect({ ...preview.snapshot, id: "" }).toEqual({
      ...written.snapshot,
      id: "",
    });
    expect(preview.partialReasons).toEqual(written.partialReasons);
  });
});
