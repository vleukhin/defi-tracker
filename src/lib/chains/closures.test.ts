import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { closeVanishedPositions } from "./closures";
import { persistFluidPositions } from "./fluid";
import { persistGmxPositions } from "./gmx";

/**
 * Контракт сборки мусора: отказ чтения закрытием не считается, а запись
 * архива идёт ДО удаления. Первое — правило всех читателей; второе — цена
 * решения: упавшее удаление чинится повтором, упавшая запись не чинится
 * ничем, потому что строки позиции уже нет.
 *
 * Клиент фальшивый: проверяется последовательность запросов, а не база.
 */

interface Journal {
  /** Запросы в порядке отправки: «select:таблица», «upsert:таблица», … */
  calls: string[];
  upserts: Record<string, unknown[][]>;
  /** Аргументы .not(): так видно, кого сборка мусора считает живым. */
  notFilters: [string, string, string][];
}

function fakeAdmin(
  rowsByTable: Record<string, unknown[]> = {},
): { admin: SupabaseClient; journal: Journal } {
  const journal: Journal = { calls: [], upserts: {}, notFilters: [] };

  function thenable(table: string) {
    const chain: Record<string, unknown> = {};
    for (const method of ["eq", "in", "order", "limit"]) {
      chain[method] = () => chain;
    }
    chain.not = (column: string, operator: string, value: string) => {
      journal.notFilters.push([column, operator, value]);
      return chain;
    };
    chain.then = (
      resolve: (value: { data: unknown[]; error: null }) => unknown,
    ) => resolve({ data: rowsByTable[table] ?? [], error: null });
    return chain;
  }

  const admin = {
    from(table: string) {
      return {
        select: () => {
          journal.calls.push(`select:${table}`);
          return thenable(table);
        },
        upsert: (rows: unknown[]) => {
          journal.calls.push(`upsert:${table}`);
          (journal.upserts[table] ??= []).push(rows);
          return Promise.resolve({ data: null, error: null });
        },
        delete: () => {
          journal.calls.push(`delete:${table}`);
          return thenable(table);
        },
      };
    },
  } as unknown as SupabaseClient;

  return { admin, journal };
}

const DOOMED = {
  id: "p1",
  protocol: "fluid",
  chain: "arbitrum",
  external_id: "0xfusdc",
  quantity: "10500",
  value_usd: null,
  payload: {
    kind: "fluid_supply",
    symbol: "USDC",
    fTokenSymbol: "fUSDC",
    coingeckoId: "usd-coin",
    decimals: 6,
  },
  updated_at: "2026-10-20T02:45:00.000Z",
};

describe("closeVanishedPositions", () => {
  it("нечего закрывать — ни цен, ни разметки, ни удаления", async () => {
    const { admin, journal } = fakeAdmin({ protocol_positions: [] });

    await closeVanishedPositions(admin, {
      userId: "u1",
      walletId: "w1",
      protocol: "fluid",
      chain: "arbitrum",
      aliveExternalIds: ["0xfusdc"],
    });

    // Обычный путь обновления платит один дешёвый select и уходит
    expect(journal.calls).toEqual(["select:protocol_positions"]);
  });

  it("запись архива отправляется ДО удаления позиции", async () => {
    const { admin, journal } = fakeAdmin({
      protocol_positions: [DOOMED],
      position_marks: [],
      coin_prices: [
        {
          coingecko_id: "usd-coin",
          price_usd: 1,
          fetched_at: new Date().toISOString(),
        },
      ],
    });

    await closeVanishedPositions(admin, {
      userId: "u1",
      walletId: "w1",
      protocol: "fluid",
      chain: "arbitrum",
      aliveExternalIds: [],
      closedAt: "2026-10-20T03:05:00.000Z",
    });

    const upsertAt = journal.calls.indexOf("upsert:closed_positions");
    const deleteAt = journal.calls.indexOf("delete:protocol_positions");
    expect(upsertAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(upsertAt);

    const [rows] = journal.upserts.closed_positions;
    expect(rows).toHaveLength(1);
    // Стоимость посчитана, хотя в кэше value_usd был null
    expect(rows[0]).toMatchObject({
      external_id: "0xfusdc",
      last_value_usd: 10500,
      title: "fUSDC",
      last_read_at: DOOMED.updated_at,
      closed_at: "2026-10-20T03:05:00.000Z",
    });
  });
});

describe("отказ чтения закрытием не считается", () => {
  it("Fluid: упавшая сеть не трогает ни позиции, ни архив", async () => {
    const { admin, journal } = fakeAdmin();

    await persistFluidPositions(admin, "u1", "w1", [
      { chain: "arbitrum", ok: false, positions: [], error: "RPC" },
    ] as never);

    expect(journal.calls).toEqual([]);
  });

  it("GMX: неоценённый пул остаётся живым, а не закрывается", async () => {
    const { admin, journal } = fakeAdmin({ protocol_positions: [] });

    await persistGmxPositions(admin, "u1", "w1", {
      chain: "arbitrum",
      ok: true,
      positions: [],
      // Пул существует, просто цена неизвестна: удалить его значило бы
      // показать закрытие, которого не было
      unpriced: [{ marketToken: "0xgm", marketName: "GM BTC/USD" }],
    } as never);

    // Единственный запрос — выборка обречённых, и 0xgm объявлен живым:
    // он в списке исключений, значит под удаление не попадёт
    expect(journal.calls).toEqual(["select:protocol_positions"]);
    expect(journal.notFilters).toEqual([
      ["external_id", "in", "(0xgm)"],
    ]);
  });
});
