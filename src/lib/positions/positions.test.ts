import { describe, expect, it } from "vitest";
import { buildPositions, positionPriceIds, type PositionRowInput } from "./positions";

/**
 * Сборка размещенных позиций (Фаза 5).
 *
 * Главное, что здесь проверяется, — неттинг Fluid. Собственные стейблы на
 * Fluid уже учтены ручной записью портфеля; если добавить депозит целиком,
 * своя часть попадет в Активы дважды и Прибыль окажется завышенной.
 */

const BASE = {
  chain: "arbitrum",
  externalId: "0xft",
  updatedAt: "2026-07-31T03:00:00.000Z",
  walletId: "w1",
  walletLabel: null,
};

function fluidRow(
  id: string,
  quantity: string,
  coingeckoId: string | null,
  symbol = "USDC",
): PositionRowInput {
  return {
    ...BASE,
    id,
    protocol: "fluid",
    externalId: `0x${id}`,
    quantity,
    valueUsd: null,
    payload: {
      kind: "fluid_supply",
      symbol,
      fTokenSymbol: `f${symbol}`,
      coingeckoId,
      decimals: 6,
    },
  };
}

function gmRow(id: string, valueUsd: number | null): PositionRowInput {
  return {
    ...BASE,
    id,
    protocol: "gmx_v2",
    externalId: `0x${id}`,
    quantity: "1000",
    valueUsd,
    payload: {
      kind: "gmx_gm",
      marketName: "ETH/USD [ETH-USDC]",
      gmPriceUsd: 1.6,
      components: [
        { side: "long", symbol: "ETH", quantity: 0.5, valueUsd: 950 },
        { side: "short", symbol: "USDC", quantity: 650, valueUsd: 650 },
      ],
    },
  };
}

function lpRow(
  id: string,
  opts: { inRange?: boolean; fees?: number | null; price1?: number | null } = {},
): PositionRowInput {
  return {
    ...BASE,
    id,
    protocol: "uni_v3",
    externalId: id,
    quantity: "123456",
    valueUsd: null,
    payload: {
      kind: "univ3_lp",
      fee: 500,
      tickLower: -201000,
      tickUpper: -200000,
      inRange: opts.inRange ?? true,
      token0: {
        symbol: "WETH",
        coingeckoId: "weth",
        quantity: 2,
        feesQuantity: opts.fees === undefined ? 0.01 : opts.fees,
      },
      token1: {
        symbol: "USDC",
        coingeckoId: opts.price1 === null ? null : "usd-coin",
        quantity: 1000,
        feesQuantity: opts.fees === undefined ? 5 : opts.fees,
      },
    },
  };
}

const PRICES = new Map<string, number>([
  ["usd-coin", 1],
  ["weth", 1900],
  ["ethereum", 1900],
]);

describe("неттинг Fluid против ручных записей", () => {
  it("в Активы попадает только разница — заемная часть", () => {
    const r = buildPositions({
      rows: [fluidRow("a", "100000", "usd-coin")],
      pricesUsd: PRICES,
      manualStableUsd: 70_000,
    });
    expect(r.summary.fluid.stableUsd).toBe(100_000);
    expect(r.summary.fluid.manualStableUsd).toBe(70_000);
    expect(r.summary.fluid.nettedUsd).toBe(30_000);
    expect(r.summary.positionsUsd).toBe(30_000);
    // Сама позиция при этом показывается целиком — пользователь видит факт
    expect(r.positions[0].valueUsd).toBe(100_000);
  });

  it("без ручных записей депозит входит целиком", () => {
    const r = buildPositions({
      rows: [fluidRow("a", "50000", "usd-coin")],
      pricesUsd: PRICES,
      manualStableUsd: 0,
    });
    expect(r.summary.positionsUsd).toBe(50_000);
  });

  it("ручных записей больше, чем на Fluid: вклад ноль, поднят флаг сверки", () => {
    // Отрицательный вклад означал бы, что часть портфеля «не существует»
    const r = buildPositions({
      rows: [fluidRow("a", "40000", "usd-coin")],
      pricesUsd: PRICES,
      manualStableUsd: 60_000,
    });
    expect(r.summary.fluid.nettedUsd).toBe(0);
    expect(r.summary.positionsUsd).toBe(0);
    expect(r.summary.fluid.manualExceedsDeposit).toBe(true);
  });

  it("нестейблы на Fluid неттингу не подлежат", () => {
    // ETH на Fluid ручными записями «Стейблов» не покрыт
    const r = buildPositions({
      rows: [fluidRow("a", "10", "ethereum", "WETH")],
      pricesUsd: PRICES,
      manualStableUsd: 70_000,
    });
    expect(r.summary.fluid.stableUsd).toBe(0);
    expect(r.summary.positionsUsd).toBe(19_000);
  });

  it("неттинг применяется к сумме депозитов по всем сетям", () => {
    const r = buildPositions({
      rows: [
        fluidRow("a", "60000", "usd-coin"),
        { ...fluidRow("b", "40000", "tether", "USDT"), chain: "base" },
      ],
      pricesUsd: new Map([...PRICES, ["tether", 1]]),
      manualStableUsd: 70_000,
    });
    expect(r.summary.fluid.stableUsd).toBe(100_000);
    expect(r.summary.positionsUsd).toBe(30_000);
  });
});

describe("оценка позиций", () => {
  it("GM берет стоимость у оракула GMX, а не суммой компонентов", () => {
    // Сумма компонентов 1600, оракул дает 1550: разница — PnL трейдеров
    const r = buildPositions({
      rows: [gmRow("g", 1550)],
      pricesUsd: PRICES,
      manualStableUsd: 0,
    });
    expect(r.positions[0].valueUsd).toBe(1550);
    expect(r.summary.positionsUsd).toBe(1550);
  });

  it("LP оценивается суммой компонентов по текущему тику", () => {
    const r = buildPositions({
      rows: [lpRow("42")],
      pricesUsd: PRICES,
      manualStableUsd: 0,
    });
    // 2 WETH * 1900 + 1000 USDC * 1
    expect(r.positions[0].valueUsd).toBe(4800);
    // Комиссии отдельной величиной: 0,01 * 1900 + 5 * 1
    expect(r.positions[0].feesUsd).toBeCloseTo(24, 6);
  });

  it("позиция вне диапазона помечается, а не считается сбоем", () => {
    const r = buildPositions({
      rows: [lpRow("42", { inRange: false })],
      pricesUsd: PRICES,
      manualStableUsd: 0,
    });
    expect(r.positions[0].inRange).toBe(false);
    expect(r.positions[0].subtitle).toContain("Вне диапазона");
  });

  it("несобранные комиссии неизвестны, если симуляция collect не удалась", () => {
    const r = buildPositions({
      rows: [lpRow("42", { fees: null })],
      pricesUsd: PRICES,
      manualStableUsd: 0,
    });
    expect(r.positions[0].feesUsd).toBeNull();
    // На стоимость самой позиции это не влияет
    expect(r.positions[0].valueUsd).toBe(4800);
  });
});

describe("null-пропагация", () => {
  it("неоцененная позиция делает вклад позиций неизвестным целиком", () => {
    // Частичная сумма выглядела бы как маленькие Активы — это ложь
    const r = buildPositions({
      rows: [gmRow("g", null), fluidRow("a", "1000", "usd-coin")],
      pricesUsd: PRICES,
      manualStableUsd: 0,
    });
    expect(r.summary.positionsUsd).toBeNull();
    expect(r.summary.unpricedCount).toBe(1);
  });

  it("нет цены компонента LP — нет оценки позиции, но количество остается", () => {
    const r = buildPositions({
      rows: [lpRow("42", { price1: null })],
      pricesUsd: PRICES,
      manualStableUsd: 0,
    });
    expect(r.positions[0].valueUsd).toBeNull();
    expect(r.positions[0].components[1].quantity).toBe(1000);
    expect(r.positions[0].components[1].valueUsd).toBeNull();
  });

  it("пустой список позиций дает честный ноль, а не null", () => {
    const r = buildPositions({
      rows: [],
      pricesUsd: PRICES,
      manualStableUsd: 0,
    });
    expect(r.summary.positionsUsd).toBe(0);
    expect(r.positions).toHaveLength(0);
  });

  it("неизвестный стейбл-депозит делает неизвестной и сверку, и вклад", () => {
    const r = buildPositions({
      rows: [fluidRow("a", "1000", null)],
      pricesUsd: PRICES,
      manualStableUsd: 0,
    });
    // coingecko id нет -> цены нет -> стоимость неизвестна
    expect(r.positions[0].valueUsd).toBeNull();
    expect(r.summary.positionsUsd).toBeNull();
  });
});

describe("прочее", () => {
  it("строки чужих протоколов и без payload игнорируются", () => {
    const r = buildPositions({
      rows: [
        { ...BASE, id: "x", protocol: "aave_v3", quantity: "1", valueUsd: 1, payload: { kind: "debt" } },
        { ...BASE, id: "y", protocol: "fluid", quantity: "1", valueUsd: 1, payload: null },
      ],
      pricesUsd: PRICES,
      manualStableUsd: 0,
    });
    expect(r.positions).toHaveLength(0);
  });

  it("позиции сортируются по стоимости, неоцененные — в конец", () => {
    const r = buildPositions({
      rows: [gmRow("g1", 100), gmRow("g2", null), gmRow("g3", 5000)],
      pricesUsd: PRICES,
      manualStableUsd: 0,
    });
    expect(r.positions.map((p) => p.valueUsd)).toEqual([5000, 100, null]);
  });

  it("positionPriceIds не запрашивает цену GM-токена — ее не существует", () => {
    const ids = positionPriceIds([
      gmRow("g", 100),
      fluidRow("a", "1", "usd-coin"),
      lpRow("42"),
    ]);
    expect(ids).toContain("usd-coin");
    expect(ids).toContain("weth");
    expect(ids).not.toContain("gmx");
  });
});
