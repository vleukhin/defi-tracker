import { describe, expect, it } from "vitest";
import type { PositionDto } from "@/lib/api/types";
import { GM_GROWTH_LEVEL_KEY, gmLevels, gmMarketPriceUsd } from "./gm-levels";

/**
 * Уровни действий по GM (docs/07 §5): −7 / −15 / −30 / −50 / −70 от точки
 * отсчёта, заданной разметкой. Ключевое, что здесь проверяется: уровни
 * считаются от ЦЕНЫ базового актива, а не от стоимости позиции, и без
 * точки отсчёта не считаются вовсе.
 */
function gm({
  entryPriceUsd = null,
  longQuantity = 1,
  longValueUsd = 100_000,
}: {
  entryPriceUsd?: number | null;
  longQuantity?: number;
  longValueUsd?: number | null;
} = {}): PositionDto {
  return {
    id: "p1",
    protocol: "gmx_v2",
    protocolLabel: "GMX v2",
    chain: "arbitrum",
    zone: "yield",
    zoneKey: "gmx_v2:arbitrum:p1",
    ownPrincipalUsd: null,
    borrowedPrincipalUsd: null,
    withdrawnUsd: null,
    entryPriceUsd,
    ownCurrentUsd: 0,
    profitUsd: null,
    profitPct: null,
    title: "GM BTC",
    subtitle: "BTC/USD [BTC-USDC]",
    quantity: "1",
    valueUsd: 20_000,
    components: [
      {
        symbol: "BTC",
        quantity: longQuantity,
        valueUsd: longValueUsd,
        side: "long",
      },
      { symbol: "USDC", quantity: 10_000, valueUsd: 10_000, side: "short" },
    ],
    feesUsd: null,
    fees24hUsd: null,
    fees24hReason: null,
    inRange: null,
    outOfRangeSince: null,
    range: null,
    supplyRatePercent: null,
    rewardsRatePercent: null,
    walletId: "w",
    walletLabel: null,
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
}

describe("цена базового актива", () => {
  it("берётся с длинной стороны пула — короткая всегда стейбл", () => {
    expect(gmMarketPriceUsd(gm({ longQuantity: 0.5, longValueUsd: 45_000 }))).toBe(
      90_000,
    );
  });

  it("нулевая стоимость компонента — это «цены не было», а не цена ноль", () => {
    // Читатель GMX пишет 0, когда оракульной цены токена не оказалось
    expect(gmMarketPriceUsd(gm({ longValueUsd: 0 }))).toBeNull();
    expect(gmMarketPriceUsd(gm({ longValueUsd: null }))).toBeNull();
  });
});

describe("без точки отсчёта уровни не считаются", () => {
  it("пустой список вместо выдуманной шкалы", () => {
    const v = gmLevels(gm({ entryPriceUsd: null }));
    expect(v.levels).toEqual([]);
    expect(v.changePercent).toBeNull();
    expect(v.reachedCount).toBeNull();
    expect(v.growth).toBeNull();
    // Цена при этом известна — не знаем мы именно точку отсчёта
    expect(v.currentPriceUsd).toBe(100_000);
  });
});

describe("шкала уровней", () => {
  it("цены уровней считаются от точки отсчёта, а не от текущей цены", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 80_000 }));
    expect(v.levels.map((l) => l.priceUsd)).toEqual([
      93_000, 85_000, 70_000, 50_000, 30_000,
    ]);
  });

  it("пройденными считаются уровни не выше текущей цены", () => {
    // Точка отсчёта 100 000, цена 84 000 — это −16%: −7 и −15 позади
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 84_000 }));
    expect(v.changePercent).toBeCloseTo(-16, 10);
    expect(v.reachedCount).toBe(2);
    expect(v.lastReached?.dropPercent).toBe(15);
    expect(v.nextLevel?.dropPercent).toBe(7);
    expect(v.toNextPercent).toBe(0);
  });

  it("на самой цене уровня уровень уже пройден", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 93_000 }));
    expect(v.lastReached?.dropPercent).toBe(7);
    expect(v.nextLevel?.dropPercent).toBe(7);
  });

  it("выше точки отсчёта пройденных уровней нет", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 110_000 }));
    expect(v.reachedCount).toBe(0);
    expect(v.lastReached).toBeNull();
    expect(v.nextLevel?.dropPercent).toBe(7);
    expect(v.changePercent).toBeCloseTo(10, 10);
  });

  it("ниже последнего уровня ближайшего впереди уже нет", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 20_000 }));
    expect(v.reachedCount).toBe(5);
    expect(v.nextLevel?.dropPercent).toBe(7);
    expect(v.toNextPercent).toBe(0);
  });

  it("уже достигнутый, но неотработанный уровень требует действия сразу", () => {
    // Цена ровно на −7%, но операции в журнале нет: до действия осталось
    // не отрицательное число и не ожидание −15%, а честный ноль процентов.
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 93_000 }));
    expect(v.toNextPercent).toBe(0);
  });

  it("действия уровня — из таблиц §5, вместе с Stability на глубоких", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000 }));
    expect(v.levels[0].stabilityAction).toBeNull();
    expect(v.levels[1].stabilityAction).toBeNull();
    expect(v.levels[2].stabilityAction).toContain("30% всей зоны");
    expect(v.levels[4].stabilityAction).toContain("оставшиеся 30%");
    expect(v.levels[0].action).toContain("на 30%");
  });
});

describe("неизвестная цена не выдаётся за «уровень не пройден»", () => {
  it("статусы уровней null, а шкала всё равно показывается", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 0 }));
    expect(v.currentPriceUsd).toBeNull();
    expect(v.levels).toHaveLength(5);
    expect(v.levels.every((l) => l.reached === null)).toBe(true);
    expect(v.reachedCount).toBeNull();
    expect(v.nextLevel).toBeNull();
    expect(v.growth?.reached).toBeNull();
  });
});

describe("рост", () => {
  it("ориентир первой фиксации — +50% от точки отсчёта (§6)", () => {
    const v = gmLevels(gm({ entryPriceUsd: 100_000, longValueUsd: 160_000 }));
    expect(v.growth?.priceUsd).toBe(150_000);
    expect(v.growth?.reached).toBe(true);
  });
});

/**
 * Отработанные уровни (docs/09 S8.3). Приходят вторым аргументом из журнала
 * операций — приложение само рынок не помнит. Главное, что здесь
 * проверяется: «отработан» и «цена сейчас ниже» — два разных признака,
 * а без второго аргумента модуль отвечает ровно как раньше.
 */
describe("отработанные уровни", () => {
  it("без второго аргумента ничего не отмечено — поведение прежнее", () => {
    const position = gm({ entryPriceUsd: 100_000, longValueUsd: 84_000 });
    const v = gmLevels(position);
    expect(v.levels.every((l) => l.acted === false)).toBe(true);
    expect(v.growth?.acted).toBe(false);
    // Тот же ответ, что и с пустым журналом
    expect(v).toEqual(gmLevels(position, []));
    expect(v.nextLevel?.dropPercent).toBe(7);
  });

  it("сценарий владельца: отработаны −7 и −15, цена отскочила до −5%", () => {
    // Ради этого случая фаза и делается: уровни позади по действию, но
    // впереди по цене — вести владельца обратно на −7% нельзя
    const v = gmLevels(
      gm({ entryPriceUsd: 100_000, longValueUsd: 95_000 }),
      [7, 15],
    );
    expect(v.changePercent).toBeCloseTo(-5, 10);
    expect(v.nextLevel?.dropPercent).toBe(30);
    // До −30% (70 000) цене от 95 000 остаётся упасть на 26,3%, а не до −7%
    expect(v.toNextPercent).toBeCloseTo(26.316, 3);
    // Рынок при этом ни одного уровня не прошёл, и лента должна молчать
    expect(v.reachedCount).toBe(0);
    expect(v.lastReached).toBeNull();
  });

  it("отметка держится и ниже текущей цены, и выше неё", () => {
    // Цена 84 000 — это −16%. Отмечены −15 (его цена 85 000 ВЫШЕ текущей,
    // рынок его уже прошёл) и −50 (цена 50 000 НИЖЕ текущей, впереди)
    const v = gmLevels(
      gm({ entryPriceUsd: 100_000, longValueUsd: 84_000 }),
      [15, 50],
    );
    expect(v.levels.map((l) => l.acted)).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
    // Признаки не сливаются: у −15 обе истины, у −50 отметка без цены
    expect(v.levels[1].reached).toBe(true);
    expect(v.levels[3].reached).toBe(false);
    // Ближайшее действие — −7: он не отмечен, хотя цена уже ниже него.
    expect(v.nextLevel?.dropPercent).toBe(7);
  });

  it("отработанный уровень выше цены не становится ближайшим", () => {
    // Цена выше точки отсчёта, но на −7% владелец уже действовал
    const v = gmLevels(
      gm({ entryPriceUsd: 100_000, longValueUsd: 110_000 }),
      [7],
    );
    expect(v.levels[0].reached).toBe(false);
    expect(v.levels[0].acted).toBe(true);
    expect(v.nextLevel?.dropPercent).toBe(15);
  });

  it("отработаны все пять — впереди действий не осталось", () => {
    const v = gmLevels(
      gm({ entryPriceUsd: 100_000, longValueUsd: 110_000 }),
      [7, 15, 30, 50, 70],
    );
    expect(v.nextLevel).toBeNull();
    expect(v.toNextPercent).toBeNull();
    // Цена при этом выше точки отсчёта, и рынок этого не подтверждает
    expect(v.reachedCount).toBe(0);
  });

  it("ориентир роста лежит в журнале уровнем −50 (§6, «Схема данных»)", () => {
    const v = gmLevels(
      gm({ entryPriceUsd: 100_000, longValueUsd: 110_000 }),
      [GM_GROWTH_LEVEL_KEY],
    );
    expect(v.growth?.acted).toBe(true);
    // +50% ещё не достигнут ценой — это отдельный признак
    expect(v.growth?.reached).toBe(false);
    // И падение на 50% отметку роста не подхватывает
    expect(v.levels[3].acted).toBe(false);
  });

  it("отметки не отменяют неизвестную цену", () => {
    const v = gmLevels(
      gm({ entryPriceUsd: 100_000, longValueUsd: 0 }),
      [7, 15],
    );
    expect(v.levels.every((l) => l.reached === null)).toBe(true);
    expect(v.levels[0].acted).toBe(true);
    // Ближайшего уровня нет: не с чем сравнивать
    expect(v.nextLevel).toBeNull();
    expect(v.toNextPercent).toBeNull();
  });

  it("без точки отсчёта отметки ничего не меняют", () => {
    const v = gmLevels(gm({ entryPriceUsd: null }), [7, 15, 30, 50, 70]);
    expect(v.levels).toEqual([]);
    expect(v.growth).toBeNull();
    expect(v.nextLevel).toBeNull();
    expect(v.toNextPercent).toBeNull();
    expect(v.reachedCount).toBeNull();
  });

  it("нулевая точка отсчёта — та же пустота, что и отсутствующая", () => {
    const v = gmLevels(gm({ entryPriceUsd: 0 }), [7]);
    expect(v.entryPriceUsd).toBeNull();
    expect(v.levels).toEqual([]);
    expect(v.growth).toBeNull();
  });
});
