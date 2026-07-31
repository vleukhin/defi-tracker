import { describe, expect, it } from "vitest";
import { buildPositions, positionPriceIds, type PositionRowInput } from "./positions";

/**
 * Сборка размещенных позиций (Фаза 5).
 *
 * Главное, что здесь проверяется, — учет собственной доли. Она указывается
 * у позиции и образует категорию «Стейблы»; раз так, стоимость позиций
 * входит в Активы за ее вычетом, иначе те же деньги посчитались бы дважды.
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

const marks = (
  key: string,
  ownPrincipalUsd: number | null,
  borrowedPrincipalUsd: number | null = null,
  withdrawnUsd: number | null = null,
  zone: "growth" | "yield" | "stability" | null = null,
) =>
  new Map([
    [key, { zone, ownPrincipalUsd, borrowedPrincipalUsd, withdrawnUsd }],
  ]);

describe("вложенное указывается двумя числами", () => {
  it("своя доля растет вместе со стоимостью позиции", () => {
    // Депозит Fluid: вложено 24 948 своих, заемных нет, стоит 25 243.
    // 295 — это начисленные проценты, и они ТОЖЕ свои, а не долг
    const r = buildPositions({
      rows: [fluidRow("a", "25243", "usd-coin")],
      pricesUsd: PRICES,
      marksByKey: marks("fluid:arbitrum:0xa", 24_948, 0),
    });
    const p = r.positions[0];
    expect(p.valueUsd).toBe(25_243);
    expect(p.profitUsd).toBe(295);
    expect(p.ownCurrentUsd).toBe(25_243);
    expect(p.borrowedPrincipalUsd).toBe(0);
  });

  it("доход делится между своим и заемным пропорционально вложенному", () => {
    // Вложено 10 000 своих и 30 000 заемных, стоит 44 000: доход 4 000,
    // из них своими заработана четверть
    const r = buildPositions({
      rows: [{ ...gmRow("g", 44_000) }],
      pricesUsd: PRICES,
      marksByKey: marks("gmx_v2:arbitrum:0xg", 10_000, 30_000),
    });
    const p = r.positions[0];
    expect(p.profitUsd).toBe(4_000);
    expect(p.profitPct).toBeCloseTo(10, 9);
    expect(p.ownCurrentUsd).toBe(11_000);
  });

  it("убыток тоже делится пропорционально", () => {
    const r = buildPositions({
      rows: [{ ...gmRow("g", 36_000) }],
      pricesUsd: PRICES,
      marksByKey: marks("gmx_v2:arbitrum:0xg", 10_000, 30_000),
    });
    expect(r.positions[0].profitUsd).toBe(-4_000);
    expect(r.positions[0].ownCurrentUsd).toBe(9_000);
  });

  it("вклад в Активы = стоимость минус текущая своя доля", () => {
    const r = buildPositions({
      rows: [fluidRow("a", "25243", "usd-coin")],
      pricesUsd: PRICES,
      marksByKey: marks("fluid:arbitrum:0xa", 24_948, 0),
    });
    expect(r.summary.grossUsd).toBe(25_243);
    expect(r.summary.ownUsd).toBe(25_243);
    expect(r.summary.positionsUsd).toBe(0);
    expect(r.summary.profitUsd).toBe(295);
  });
});

describe("выводы из позиции", () => {
  it("продажа части GM с переводом BTC/ETH в залог — не убыток", () => {
    // Вложено 20 800 заемных, выведено 12 000 (ушли в Growth как BTC/ETH),
    // осталось на 8 046. Без учета вывода это выглядело бы минусом 12 754
    const r = buildPositions({
      rows: [gmRow("g", 8_046)],
      pricesUsd: PRICES,
      marksByKey: marks("gmx_v2:arbitrum:0xg", 0, 20_800, 12_000),
    });
    const p = r.positions[0];
    expect(p.profitUsd).toBeCloseTo(8_046 + 12_000 - 20_800, 6);
    expect(p.withdrawnUsd).toBe(12_000);
  });

  it("без выводов формула прежняя", () => {
    const r = buildPositions({
      rows: [gmRow("g", 22_000)],
      pricesUsd: PRICES,
      marksByKey: marks("gmx_v2:arbitrum:0xg", 0, 20_800),
    });
    expect(r.positions[0].profitUsd).toBe(1_200);
    expect(r.positions[0].withdrawnUsd).toBeNull();
  });

  it("вывод не меняет текущую собственную долю", () => {
    // Доля считается от стоимости по пропорции вложенного
    const r = buildPositions({
      rows: [gmRow("g", 10_000)],
      pricesUsd: PRICES,
      marksByKey: marks("gmx_v2:arbitrum:0xg", 5_000, 5_000, 8_000),
    });
    expect(r.positions[0].ownCurrentUsd).toBe(5_000);
    expect(r.positions[0].profitUsd).toBe(8_000);
  });
});

describe("неполная разметка", () => {
  it("без заемной части доход не выводится — остаток неоднозначен", () => {
    // Это и была ошибка предыдущей версии: 295 выдавались за долг
    const r = buildPositions({
      rows: [fluidRow("a", "25243", "usd-coin")],
      pricesUsd: PRICES,
      marksByKey: marks("fluid:arbitrum:0xa", 24_948, null),
    });
    const p = r.positions[0];
    expect(p.profitUsd).toBeNull();
    // Своя доля падает обратно на вложенное: доход не распределяем
    expect(p.ownCurrentUsd).toBe(24_948);
    expect(r.summary.unmarkedCount).toBe(1);
  });

  it("совсем без разметки позиция считается целиком заемной, но помечается", () => {
    const r = buildPositions({
      rows: [fluidRow("a", "50000", "usd-coin")],
      pricesUsd: PRICES,
    });
    expect(r.positions[0].ownPrincipalUsd).toBeNull();
    expect(r.positions[0].ownCurrentUsd).toBe(0);
    expect(r.summary.ownUsd).toBe(0);
    expect(r.summary.unmarkedCount).toBe(1);
  });

  it("ноль своих — утверждение «все заемное», а не отсутствие разметки", () => {
    const r = buildPositions({
      rows: [fluidRow("a", "50000", "usd-coin")],
      pricesUsd: PRICES,
      marksByKey: marks("fluid:arbitrum:0xa", 0, 48_000),
    });
    expect(r.positions[0].ownCurrentUsd).toBe(0);
    expect(r.positions[0].profitUsd).toBe(2_000);
    expect(r.summary.unmarkedCount).toBe(0);
  });

  it("суммарный доход неизвестен, пока размечены не все позиции", () => {
    const r = buildPositions({
      rows: [fluidRow("a", "1000", "usd-coin"), gmRow("g", 500)],
      pricesUsd: PRICES,
      marksByKey: marks("fluid:arbitrum:0xa", 900, 0),
    });
    expect(r.summary.profitUsd).toBeNull();
  });
});

describe("разметка зон", () => {
  it("по умолчанию позиция попадает в Yield", () => {
    const r = buildPositions({ rows: [gmRow("g", 100)], pricesUsd: PRICES });
    expect(r.positions[0].zone).toBe("yield");
  });

  it("разметка применяется по натуральному ключу, а не по id строки", () => {
    const row = fluidRow("a", "1000", "usd-coin");
    const r = buildPositions({
      rows: [row],
      pricesUsd: PRICES,
      marksByKey: marks("fluid:arbitrum:0xa", null, null, null, "stability"),
    });
    expect(r.positions[0].zone).toBe("stability");
    expect(r.positions[0].zoneKey).toBe("fluid:arbitrum:0xa");
  });

  it("ключ переживает пересоздание строки: id другой, ключ тот же", () => {
    const first = buildPositions({ rows: [gmRow("g", 100)], pricesUsd: PRICES });
    const again = buildPositions({
      rows: [{ ...gmRow("g", 100), id: "совсем-другой-id" }],
      pricesUsd: PRICES,
    });
    expect(again.positions[0].zoneKey).toBe(first.positions[0].zoneKey);
  });
});

describe("оценка позиций", () => {
  it("GM берет стоимость у оракула GMX, а не суммой компонентов", () => {
    // Сумма компонентов 1600, оракул дает 1550: разница — PnL трейдеров
    const r = buildPositions({
      rows: [gmRow("g", 1550)],
      pricesUsd: PRICES,
    });
    expect(r.positions[0].valueUsd).toBe(1550);
    expect(r.summary.positionsUsd).toBe(1550);
  });

  it("LP оценивается суммой компонентов по текущему тику", () => {
    const r = buildPositions({
      rows: [lpRow("42")],
      pricesUsd: PRICES,
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
    });
    expect(r.positions[0].inRange).toBe(false);
    expect(r.positions[0].subtitle).toContain("Вне диапазона");
  });

  it("несобранные комиссии неизвестны, если симуляция collect не удалась", () => {
    const r = buildPositions({
      rows: [lpRow("42", { fees: null })],
      pricesUsd: PRICES,
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
    });
    expect(r.summary.positionsUsd).toBeNull();
    expect(r.summary.unpricedCount).toBe(1);
  });

  it("нет цены компонента LP — нет оценки позиции, но количество остается", () => {
    const r = buildPositions({
      rows: [lpRow("42", { price1: null })],
      pricesUsd: PRICES,
    });
    expect(r.positions[0].valueUsd).toBeNull();
    expect(r.positions[0].components[1].quantity).toBe(1000);
    expect(r.positions[0].components[1].valueUsd).toBeNull();
  });

  it("пустой список позиций дает честный ноль, а не null", () => {
    const r = buildPositions({
      rows: [],
      pricesUsd: PRICES,
    });
    expect(r.summary.positionsUsd).toBe(0);
    expect(r.positions).toHaveLength(0);
  });

  it("неизвестный стейбл-депозит делает неизвестной и сверку, и вклад", () => {
    const r = buildPositions({
      rows: [fluidRow("a", "1000", null)],
      pricesUsd: PRICES,
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
    });
    expect(r.positions).toHaveLength(0);
  });

  it("позиции сортируются по стоимости, неоцененные — в конец", () => {
    const r = buildPositions({
      rows: [gmRow("g1", 100), gmRow("g2", null), gmRow("g3", 5000)],
      pricesUsd: PRICES,
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
