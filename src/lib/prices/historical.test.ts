import { describe, expect, it, vi } from "vitest";
import {
  getHistoricalCoinPrices,
  nearestPoint,
  PRICE_MATCH_TOLERANCE_SEC,
} from "./historical";
import { gmxPriceToUsd, usdToGmxPrice } from "./gmx-api";

const TARGET_SEC = Date.parse("2026-10-26T03:00:00.000Z") / 1000;
const at = (iso: string, price: number): [number, number] => [
  Date.parse(iso),
  price,
];

describe("nearestPoint", () => {
  it("берёт ближайшую точку, а не первую и не последнюю", () => {
    const points = [
      at("2026-10-26T01:00:00Z", 1),
      at("2026-10-26T02:55:00Z", 2),
      at("2026-10-26T05:00:00Z", 3),
    ];
    expect(nearestPoint(points, TARGET_SEC * 1000)).toEqual(points[1]);
  });

  it("на пустом ряде отдаёт null, а не ноль", () => {
    expect(nearestPoint([], TARGET_SEC * 1000)).toBeNull();
  });
});

describe("getHistoricalCoinPrices", () => {
  it("оценивает монету ценой НА МОМЕНТ, а не последней в ряду", async () => {
    const fetchRange = vi.fn(async () => ({
      points: [
        at("2026-10-26T02:55:00Z", 3900),
        at("2026-10-26T12:00:00Z", 4500),
      ],
      stepSec: 300,
    }));

    const prices = await getHistoricalCoinPrices(["ethereum"], TARGET_SEC, {
      fetchRange,
    });

    expect(prices.get("ethereum")?.priceUsd).toBe(3900);
    // Время записывается ФАКТИЧЕСКОЙ точки — по нему видно промах
    expect(prices.get("ethereum")?.fetchedAt).toBe("2026-10-26T02:55:00.000Z");
    expect(prices.get("ethereum")?.offsetSec).toBe(300);
    expect(prices.get("ethereum")?.stale).toBe(false);
  });

  it("помечает stale, когда ближайшая котировка дальше допуска", async () => {
    const far = TARGET_SEC * 1000 + (PRICE_MATCH_TOLERANCE_SEC + 60) * 1000;
    const fetchRange = vi.fn(async () => ({
      points: [[far, 4000] as [number, number]],
      stepSec: null,
    }));

    const prices = await getHistoricalCoinPrices(["ethereum"], TARGET_SEC, {
      fetchRange,
    });

    expect(prices.get("ethereum")?.stale).toBe(true);
  });

  it("монету без ряда пропускает, а не подставляет текущую цену", async () => {
    // Ключа нет — движок прочитает это как «цены нет» и пометит точку
    // частичной. Подстановка сегодняшней цены была бы молчаливым враньём
    const fetchRange = vi.fn(async (id: string) => {
      if (id === "bitcoin") throw new Error("HTTP 429");
      return { points: [at("2026-10-26T03:00:00Z", 4000)], stepSec: 300 };
    });

    const prices = await getHistoricalCoinPrices(
      ["bitcoin", "ethereum"],
      TARGET_SEC,
      { fetchRange },
    );

    expect(prices.has("bitcoin")).toBe(false);
    expect(prices.get("ethereum")?.priceUsd).toBe(4000);
  });

  it("запрашивает каждую монету один раз, узким окном вокруг момента", async () => {
    const fetchRange = vi.fn(
      async (_id: string, _fromSec: number, _toSec: number) => ({
        points: [at("2026-10-26T03:00:00Z", 1)],
        stepSec: 300,
      }),
    );

    await getHistoricalCoinPrices(
      ["ethereum", "ethereum", "bitcoin"],
      TARGET_SEC,
      { fetchRange },
    );

    expect(fetchRange).toHaveBeenCalledTimes(2);
    const [, fromSec, toSec] = fetchRange.mock.calls[0];
    expect(fromSec).toBeLessThan(TARGET_SEC);
    expect(toSec).toBeGreaterThan(TARGET_SEC);
    // Окно до суток — иначе CoinGecko молча переходит на часовой шаг
    expect(toSec - fromSec).toBeLessThanOrEqual(86_400);
  });
});

describe("usdToGmxPrice", () => {
  /**
   * GM-пул оценивается вызовом, которому цены токенов передаются
   * аргументами. Чтобы оценить пул на прошлую дату, историческую цену надо
   * положить в тот же масштаб, в каком её отдаёт оракул.
   */
  it("переводит доллары в масштаб оракула обратимо", () => {
    for (const [priceUsd, decimals] of [
      [4000, 18],
      [1, 6],
      [0.9998, 6],
      [68_000, 8],
    ] as const) {
      const raw = usdToGmxPrice(priceUsd, decimals);
      expect(gmxPriceToUsd(raw, decimals)).toBeCloseTo(priceUsd, 6);
    }
  });

  it("не теряет точность на масштабах, где double уже не считает", () => {
    // 1 USDC при decimals = 6 — это 1e24, далеко за пределами точного
    // диапазона double: наивное умножение дало бы мусор в младших разрядах
    expect(usdToGmxPrice(1, 6)).toBe(10n ** 24n);
  });
});
