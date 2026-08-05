import { describe, expect, it } from "vitest";
import {
  buildZones,
  defaultZoneForCategory,
  zoneOfManual,
  type BuildZonesInput,
  type FreeAtom,
} from "./zones";

/**
 * Зоны стратегии Capital Growth.
 *
 * Главный тест здесь — инвариант: сумма зон обязана совпадать с «Активами»,
 * то есть с «залог + свободные стейблы + позиции целиком».
 *
 * В зонах, в отличие от категорий, ничего не вычитается: позиция учтена
 * полностью, а ее собственная доля живет в категории «Стейблы». Если она
 * начнет попадать и сюда, инвариант разойдется.
 */

const empty: BuildZonesInput = {
  collateral: [],
  manual: [],
  positions: [],
};

const zoneValue = (r: ReturnType<typeof buildZones>, zone: string) =>
  r.zones.find((z) => z.zone === zone)!.valueUsd;

describe("инвариант: сумма зон = Активы", () => {
  it("залог + свободные стейблы + позиции ЦЕЛИКОМ", () => {
    // В зонах ничего не вычитается: позиция учтена полностью, а ее
    // собственная доля живет в категории «Стейблы», не в зонах
    const r = buildZones({
      collateral: [
        { category: "btc", valueUsd: 100_000 },
        { category: "eth", valueUsd: 50_000 },
      ],
      manual: [
        { id: "m1", category: "stable", label: "Свободные", valueUsd: 5_000, zone: null },
      ],
      positions: [
        { id: "p1", protocol: "uni_v3", title: "LP", valueUsd: 20_000, zone: "yield", ownUsd: 14_600 },
        { id: "p2", protocol: "fluid", title: "fUSDC", valueUsd: 10_000, zone: "yield", ownUsd: 0 },
      ],
    });
    expect(r.totalUsd).toBe(100_000 + 50_000 + 5_000 + 20_000 + 10_000);
  });

  it("собственная доля позиции не появляется в зонах второй раз", () => {
    // Ровно случай docs/07 §9.4: свои уехали с Fluid в CLMM-позицию.
    // Позиция стоит 40 000, из них 14 600 свои — в зоне все равно 40 000.
    const r = buildZones({
      collateral: [],
      manual: [],
      positions: [
        { id: "p1", protocol: "uni_v3", title: "WETH/USDC", valueUsd: 40_000, zone: "yield", ownUsd: 14_600 },
      ],
    });
    expect(zoneValue(r, "yield")).toBe(40_000);
    expect(r.totalUsd).toBe(40_000);
    expect(r.ownInPositionsUsd).toBe(14_600);
  });

  it("разметка своих не меняет сумму зон", () => {
    const base: BuildZonesInput = {
      collateral: [{ category: "btc", valueUsd: 1_000 }],
      manual: [],
      positions: [
        { id: "p1", protocol: "fluid", title: "fUSDC", valueUsd: 500, zone: "yield", ownUsd: null },
      ],
    };
    const bez = buildZones(base);
    const s = buildZones({
      ...base,
      positions: [{ ...base.positions[0], ownUsd: 300 }],
    });
    expect(s.totalUsd).toBe(bez.totalUsd);
  });
});

describe("распределение по зонам", () => {
  it("залог всегда в Growth", () => {
    const r = buildZones({
      ...empty,
      collateral: [
        { category: "btc", valueUsd: 10 },
        { category: "eth", valueUsd: 5 },
      ],
    });
    expect(zoneValue(r, "growth")).toBe(15);
    expect(zoneValue(r, "yield")).toBe(0);
  });

  it("неразмеченная ручная запись идет по категории", () => {
    const r = buildZones({
      ...empty,
      manual: [
        { id: "a", category: "stable", label: "s", valueUsd: 100, zone: null },
        { id: "b", category: "btc", label: "b", valueUsd: 200, zone: null },
      ],
    });
    expect(zoneValue(r, "stability")).toBe(100);
    expect(zoneValue(r, "growth")).toBe(200);
  });

  it("явная разметка перебивает категорию", () => {
    // Стейблы бывают и в Yield — это разные задачи одних и тех же монет
    const r = buildZones({
      ...empty,
      manual: [
        { id: "a", category: "stable", label: "s", valueUsd: 100, zone: "yield" },
      ],
    });
    expect(zoneValue(r, "yield")).toBe(100);
    expect(zoneValue(r, "stability")).toBe(0);
  });

  it("позиция уходит в свою зону", () => {
    const r = buildZones({
      ...empty,
      positions: [
        { id: "p", protocol: "fluid", title: "PT", valueUsd: 70, zone: "stability", ownUsd: null },
      ],
    });
    expect(zoneValue(r, "stability")).toBe(70);
  });

  it("собственная доля не вычитается из зоны свободных стейблов", () => {
    // Свободные стейблы и деньги внутри позиции — разные суммы
    const r = buildZones({
      ...empty,
      manual: [
        { id: "a", category: "stable", label: "s", valueUsd: 100, zone: null },
      ],
      positions: [
        { id: "p", protocol: "fluid", title: "f", valueUsd: 500, zone: "yield", ownUsd: 400 },
      ],
    });
    expect(zoneValue(r, "stability")).toBe(100);
    expect(zoneValue(r, "yield")).toBe(500);
  });
});

describe("честность вывода", () => {
  it("неоцененная позиция делает зону и итог неизвестными", () => {
    const r = buildZones({
      ...empty,
      collateral: [{ category: "btc", valueUsd: 100 }],
      positions: [
        { id: "p", protocol: "gmx_v2", title: "GM", valueUsd: null, zone: "yield", ownUsd: null },
      ],
    });
    expect(zoneValue(r, "yield")).toBeNull();
    expect(r.totalUsd).toBeNull();
    expect(r.unpricedPositions).toBe(1);
    // Growth при этом известна и показывается
    expect(zoneValue(r, "growth")).toBe(100);
  });

  it("доли не считаются, пока знаменатель неизвестен", () => {
    const r = buildZones({
      ...empty,
      collateral: [{ category: "btc", valueUsd: 100 }],
      positions: [
        { id: "p", protocol: "gmx_v2", title: "GM", valueUsd: null, zone: "yield", ownUsd: null },
      ],
    });
    // Иначе проценты не сложились бы в 100 и вводили бы в заблуждение
    expect(r.zones.every((z) => z.percent === null)).toBe(true);
  });

  it("доли складываются в 100 при известном итоге", () => {
    const r = buildZones({
      ...empty,
      collateral: [{ category: "btc", valueUsd: 75 }],
      positions: [
        { id: "p", protocol: "uni_v3", title: "LP", valueUsd: 25, zone: "yield", ownUsd: null },
      ],
    });
    const sum = r.zones.reduce((s, z) => s + (z.percent ?? 0), 0);
    expect(sum).toBeCloseTo(100, 9);
  });

  it("неразмеченные позиции считаются отдельно", () => {
    // Такая позиция идет как целиком заемная, но ее видно
    const r = buildZones({
      ...empty,
      positions: [
        { id: "p1", protocol: "fluid", title: "a", valueUsd: 100, zone: "yield", ownUsd: null },
        { id: "p2", protocol: "fluid", title: "b", valueUsd: 200, zone: "yield", ownUsd: 50 },
      ],
    });
    expect(r.unmarkedPositions).toBe(1);
    expect(r.ownInPositionsUsd).toBe(50);
  });

  it("пустой портфель — нули, а не null", () => {
    const r = buildZones(empty);
    expect(r.totalUsd).toBe(0);
    expect(r.zones).toHaveLength(3);
    expect(r.zones.every((z) => z.valueUsd === 0)).toBe(true);
  });
});

describe("зона по умолчанию", () => {
  it("стейблы — Stability, базовые активы — Growth", () => {
    expect(defaultZoneForCategory("stable")).toBe("stability");
    expect(defaultZoneForCategory("btc")).toBe("growth");
    expect(defaultZoneForCategory("eth")).toBe("growth");
  });

  it("zoneOfManual уважает явную разметку", () => {
    expect(
      zoneOfManual({ id: "a", category: "stable", label: "s", valueUsd: 1, zone: "yield" }),
    ).toBe("yield");
    expect(
      zoneOfManual({ id: "a", category: "stable", label: "s", valueUsd: 1, zone: null }),
    ).toBe("stability");
  });
});

/**
 * Свободные средства на кошельке (Фаза 7).
 *
 * Разметка «свои / заемные» — единственное, что двигает эти деньги между
 * зонами; сумма зон при этом не меняется.
 */
describe("свободные средства в зонах", () => {
  const freeStable = (over: Partial<FreeAtom> = {}): FreeAtom => ({
    id: "w1:arbitrum:0xaf88",
    category: "stable",
    symbol: "USDC",
    valueUsd: 10_000,
    funds: null,
    ...over,
  });

  it("заемные стейблы — Yield, а не Stability", () => {
    // Заняли под залог и еще не разместили: деньги в пути в зону доходности,
    // а не в резерв. Stability по стратегии состоит из собственных денег
    const r = buildZones({ ...empty, free: [freeStable({ funds: "borrowed" })] });
    expect(zoneValue(r, "yield")).toBe(10_000);
    expect(zoneValue(r, "stability")).toBe(0);
  });

  it("свои и неразмеченные стейблы — Stability", () => {
    for (const funds of ["own", null] as const) {
      const r = buildZones({ ...empty, free: [freeStable({ funds })] });
      expect(zoneValue(r, "stability")).toBe(10_000);
      expect(zoneValue(r, "yield")).toBe(0);
    }
  });

  it("свои и неразмеченные BTC/ETH — Growth; заемные и здесь Yield", () => {
    for (const funds of ["own", "borrowed", null] as const) {
      const r = buildZones({
        ...empty,
        free: [freeStable({ category: "eth", symbol: "ETH", funds })],
      });
      // Правило «заемные -> Yield» сильнее категории: занятый ETH — рабочий
      // капитал, который вернут кредитору, а не растимая база стратегии
      const expected = funds === "borrowed" ? "yield" : "growth";
      expect(zoneValue(r, expected)).toBe(10_000);
    }
  });

  it("инвариант держится: свободные входят целиком, включая заемные", () => {
    const r = buildZones({
      collateral: [{ category: "btc", valueUsd: 100_000 }],
      manual: [
        { id: "m1", category: "stable", label: "Биржа", valueUsd: 5_000, zone: null },
      ],
      free: [
        freeStable({ funds: "borrowed", valueUsd: 20_000 }),
        freeStable({ id: "w1:base:native", funds: "own", valueUsd: 3_000 }),
      ],
      positions: [
        { id: "p1", protocol: "gmx_v2", title: "GM", valueUsd: 8_000, zone: "yield", ownUsd: 1_000 },
      ],
    });
    // 100 000 залог + 5 000 ручные + 23 000 свободные + 8 000 позиция
    expect(r.totalUsd).toBe(136_000);
    expect(r.freeOwnUsd).toBe(3_000);
    expect(r.freeBorrowedUsd).toBe(20_000);
    expect(r.unmarkedFree).toBe(0);
  });

  it("разметка перекладывает сумму между зонами, не меняя итог", () => {
    const totals = (["own", "borrowed"] as const).map((funds) => {
      const r = buildZones({ ...empty, free: [freeStable({ funds })] });
      return r.totalUsd;
    });
    expect(totals[0]).toBe(totals[1]);
  });

  it("без входа free результат прежний", () => {
    const r = buildZones(empty);
    expect(r.freeOwnUsd).toBe(0);
    expect(r.freeBorrowedUsd).toBe(0);
    expect(r.unmarkedFree).toBe(0);
    expect(r.zones.every((z) => z.freeUsd === 0)).toBe(true);
  });
});
