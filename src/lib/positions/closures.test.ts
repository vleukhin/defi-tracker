import { describe, expect, it } from "vitest";
import {
  buildClosedPositions,
  buildClosureRows,
  type ClosureReadRow,
  type MarkRow,
  type VanishedRow,
} from "./closures";
import { zoneKeyOf } from "./positions";

/**
 * Закрытые позиции.
 *
 * Два утверждения проверяются здесь прежде прочего. Первое: стоимость
 * считается в момент закрытия, а не копируется из value_usd — у Fluid, CLMM
 * и Pendle в кэше там null, и копия дала бы прочерк у трёх протоколов из
 * четырёх. Второе: разметка копируется снимком, поэтому повторный вход
 * в тот же рынок прошлую запись не переписывает.
 *
 * И общее правило проекта: NULL не равен нулю. Неразмеченная позиция
 * закрывается с неизвестным итогом, а не с нулевым.
 */

const CONTEXT = {
  userId: "u1",
  walletId: "w1",
  closedAt: "2026-10-20T03:05:00.000Z",
};

const READ_AT = "2026-10-20T02:45:00.000Z";

function fluidRow(externalId = "0xfusdc", quantity = "10500"): VanishedRow {
  return {
    id: `id-${externalId}`,
    protocol: "fluid",
    chain: "arbitrum",
    external_id: externalId,
    quantity,
    // Так и лежит в кэше: цену читатель не пишет, её подставляет показ
    value_usd: null,
    payload: {
      kind: "fluid_supply",
      symbol: "USDC",
      fTokenSymbol: "fUSDC",
      coingeckoId: "usd-coin",
      decimals: 6,
    },
    updated_at: READ_AT,
  };
}

function gmRow(valueUsd: number | null): VanishedRow {
  return {
    id: "id-gm",
    protocol: "gmx_v2",
    chain: "arbitrum",
    external_id: "0xgm",
    quantity: "5000",
    value_usd: valueUsd,
    payload: {
      kind: "gmx_gm",
      marketName: "BTC/USD [BTC-USDC]",
      gmPriceUsd: 1.6,
      components: [],
    },
    updated_at: READ_AT,
  };
}

function pendleRow(tokenType: "pt" | "yt" | "lp"): VanishedRow {
  return {
    id: `id-${tokenType}`,
    protocol: "pendle",
    chain: "ethereum",
    external_id: `0x${tokenType}`,
    quantity: "1000",
    value_usd: null,
    payload: {
      kind: "pendle",
      tokenType,
      token: `0x${tokenType}`,
      market: "0xmarket",
      marketName: "sUSDe 25DEC2026",
      expiry: "2026-12-25T00:00:00.000Z",
      assetSymbol: "USDe",
      assetCoingeckoId: "ethena-usde",
      rateToAsset: 0.97,
      impliedApyPercent: 12,
      underlyingApyPercent: 10,
    },
    updated_at: READ_AT,
  };
}

function mark(
  externalId: string,
  own: number | null,
  borrowed: number | null,
  extra: Partial<MarkRow> = {},
): MarkRow {
  return {
    external_id: externalId,
    zone: null,
    own_principal_usd: own,
    borrowed_principal_usd: borrowed,
    withdrawn_usd: null,
    entry_price_usd: null,
    ...extra,
  };
}

describe("запись закрытия", () => {
  it("стоимость Fluid считается по цене, а не берётся из value_usd", () => {
    const [row] = buildClosureRows({
      ...CONTEXT,
      rows: [fluidRow()],
      marks: [],
      pricesUsd: new Map([["usd-coin", 1]]),
    });

    // Главная проверка: в кэше value_usd был null, а в архив ушло число
    expect(row.last_value_usd).toBe(10500);
    expect(row.title).toBe("fUSDC");
    expect(row.subtitle).toBe("Депозит USDC");
  });

  it("стоимость GM-пула переносится от оракула как есть", () => {
    const [row] = buildClosureRows({
      ...CONTEXT,
      rows: [gmRow(8046)],
      marks: [],
      pricesUsd: new Map(),
    });

    expect(row.last_value_usd).toBe(8046);
    expect(row.title).toBe("GM BTC/USD");
  });

  it("нет цены актива — стоимость null, а не ноль", () => {
    const [row] = buildClosureRows({
      ...CONTEXT,
      rows: [fluidRow()],
      marks: [],
      pricesUsd: new Map(),
    });

    expect(row.last_value_usd).toBeNull();
  });

  it("стоимость Pendle считается через курс к активу", () => {
    const [row] = buildClosureRows({
      ...CONTEXT,
      rows: [pendleRow("pt")],
      marks: [],
      pricesUsd: new Map([["ethena-usde", 1]]),
    });

    expect(row.last_value_usd).toBeCloseTo(970, 6);
    expect(row.title).toBe("PT sUSDe 25DEC2026");
  });

  it("разметка копируется как есть, зона умолчанием не подставляется", () => {
    const [row] = buildClosureRows({
      ...CONTEXT,
      rows: [fluidRow()],
      marks: [
        mark("0xfusdc", 10000, 0, {
          zone: "stability",
          withdrawn_usd: 500,
          entry_price_usd: 62000,
        }),
      ],
      pricesUsd: new Map([["usd-coin", 1]]),
    });

    expect(row.zone).toBe("stability");
    expect(row.own_principal_usd).toBe(10000);
    expect(row.borrowed_principal_usd).toBe(0);
    expect(row.withdrawn_usd).toBe(500);
    expect(row.entry_price_usd).toBe(62000);
  });

  it("без разметки все её поля null, а не нули", () => {
    const [row] = buildClosureRows({
      ...CONTEXT,
      rows: [fluidRow()],
      marks: [],
      pricesUsd: new Map([["usd-coin", 1]]),
    });

    expect(row.zone).toBeNull();
    expect(row.own_principal_usd).toBeNull();
    expect(row.borrowed_principal_usd).toBeNull();
    expect(row.withdrawn_usd).toBeNull();
    expect(row.entry_price_usd).toBeNull();
  });

  it("last_read_at берётся из момента чтения, а не из «сейчас»", () => {
    const [row] = buildClosureRows({
      ...CONTEXT,
      rows: [fluidRow()],
      marks: [],
      pricesUsd: new Map(),
    });

    expect(row.last_read_at).toBe(READ_AT);
    expect(row.closed_at).toBe(CONTEXT.closedAt);
    expect(row.last_read_at).not.toBe(row.closed_at);
  });

  it("нераспознанный payload теряет описание, но не запись", () => {
    const rows = buildClosureRows({
      ...CONTEXT,
      rows: [
        {
          ...fluidRow("0xdeadbeefdeadbeefdead"),
          payload: { kind: "что-то-новое" },
          value_usd: 123,
        },
      ],
      marks: [],
      pricesUsd: new Map(),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Fluid");
    expect(rows[0].subtitle).toBe("0xdeadbe…dead");
    // Единственное, что о стоимости известно без разбора payload
    expect(rows[0].last_value_usd).toBe(123);
  });

  it("повторный вход в тот же рынок — другое событие, а не правка прошлого", () => {
    const first = buildClosureRows({
      ...CONTEXT,
      rows: [fluidRow()],
      marks: [mark("0xfusdc", 10000, 0)],
      pricesUsd: new Map([["usd-coin", 1]]),
    });

    const second = buildClosureRows({
      ...CONTEXT,
      closedAt: "2026-11-05T03:05:00.000Z",
      rows: [{ ...fluidRow(), updated_at: "2026-11-05T02:45:00.000Z" }],
      // Разметку владелец переписал под новый цикл
      marks: [mark("0xfusdc", 3000, 0)],
      pricesUsd: new Map([["usd-coin", 1]]),
    });

    // Ключ конфликта различает их по моменту чтения
    expect(first[0].last_read_at).not.toBe(second[0].last_read_at);
    // И снимок первой записи от новой разметки не поехал
    expect(first[0].own_principal_usd).toBe(10000);
    expect(second[0].own_principal_usd).toBe(3000);
  });

  it("две позиции закрываются пачкой с одним closed_at", () => {
    const rows = buildClosureRows({
      ...CONTEXT,
      rows: [pendleRow("pt"), pendleRow("yt")],
      marks: [],
      pricesUsd: new Map([["ethena-usde", 1]]),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].closed_at).toBe(rows[1].closed_at);
  });
});

function readRow(over: Partial<ClosureReadRow> = {}): ClosureReadRow {
  return {
    id: "c1",
    protocol: "fluid",
    chain: "arbitrum",
    external_id: "0xfusdc",
    title: "fUSDC",
    subtitle: "Депозит USDC",
    last_value_usd: 8000,
    last_quantity: "8000",
    payload: null,
    last_read_at: READ_AT,
    closed_at: CONTEXT.closedAt,
    zone: null,
    own_principal_usd: null,
    borrowed_principal_usd: null,
    withdrawn_usd: null,
    entry_price_usd: null,
    wallet_id: "w1",
    ...over,
  };
}

describe("сборка архива", () => {
  it("итог считается по формуле стоимость + выведено − вложено", () => {
    const [dto] = buildClosedPositions([
      readRow({
        last_value_usd: 8000,
        own_principal_usd: 10000,
        borrowed_principal_usd: 0,
        withdrawn_usd: 2500,
      }),
    ]);

    expect(dto.profitUsd).toBe(500);
    expect(dto.profitPct).toBeCloseTo(5, 6);
  });

  it("выведенное не указано — трактуется нулём: выводов обычно нет", () => {
    const [dto] = buildClosedPositions([
      readRow({
        last_value_usd: 8000,
        own_principal_usd: 10000,
        borrowed_principal_usd: 0,
        withdrawn_usd: null,
      }),
    ]);

    expect(dto.profitUsd).toBe(-2000);
  });

  it("вложенное размечено наполовину — итог неизвестен, а не нулевой", () => {
    const [dto] = buildClosedPositions([
      readRow({ own_principal_usd: 10000, borrowed_principal_usd: null }),
    ]);

    expect(dto.profitUsd).toBeNull();
    expect(dto.profitPct).toBeNull();
  });

  it("позиция закрылась неразмеченной — итога нет", () => {
    const [dto] = buildClosedPositions([readRow()]);

    expect(dto.profitUsd).toBeNull();
    expect(dto.ownPrincipalUsd).toBeNull();
  });

  it("стоимость не была известна — итога нет даже при полной разметке", () => {
    const [dto] = buildClosedPositions([
      readRow({
        last_value_usd: null,
        own_principal_usd: 10000,
        borrowed_principal_usd: 0,
      }),
    ]);

    expect(dto.lastValueUsd).toBeNull();
    expect(dto.profitUsd).toBeNull();
  });

  it("зона из снимка побеждает, умолчание помечено как умолчание", () => {
    const [marked] = buildClosedPositions([readRow({ zone: "stability" })]);
    expect(marked.zone).toBe("stability");
    expect(marked.zoneAssumed).toBe(false);

    const [assumed] = buildClosedPositions([readRow()]);
    expect(assumed.zone).toBe("yield");
    expect(assumed.zoneAssumed).toBe(true);
  });

  it("неразмеченный PT Pendle по умолчанию Stability, YT — Yield", () => {
    const [pt] = buildClosedPositions([
      readRow({ protocol: "pendle", payload: { tokenType: "pt" } }),
    ]);
    expect(pt.zone).toBe("stability");
    expect(pt.zoneAssumed).toBe(true);

    const [yt] = buildClosedPositions([
      readRow({ protocol: "pendle", payload: { tokenType: "yt" } }),
    ]);
    expect(yt.zone).toBe("yield");
  });

  it("натуральный ключ тот же, которым живёт разметка", () => {
    const [dto] = buildClosedPositions([readRow()]);

    expect(dto.zoneKey).toBe(
      zoneKeyOf({
        protocol: "fluid",
        chain: "arbitrum",
        externalId: "0xfusdc",
      }),
    );
  });

  it("numeric из PostgREST приходит строкой и становится числом", () => {
    const [dto] = buildClosedPositions([
      readRow({
        last_value_usd: "8000.5",
        own_principal_usd: "10000",
        borrowed_principal_usd: "0",
      }),
    ]);

    expect(dto.lastValueUsd).toBe(8000.5);
    expect(dto.profitUsd).toBeCloseTo(-1999.5, 6);
  });

  it("посторонний протокол в архиве не показывается позицией", () => {
    expect(buildClosedPositions([readRow({ protocol: "aave_v3" })])).toEqual([]);
  });
});
