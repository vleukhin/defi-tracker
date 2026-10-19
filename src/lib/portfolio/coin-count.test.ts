import { describe, expect, it } from "vitest";
import type { SnapshotCompositionDto } from "@/lib/api/types";
import { coinCount, coinCountOf } from "./coin-count";
import { computePortfolio, type PriceInput } from "./portfolio";
import { buildSnapshotRows, type SnapshotSource } from "./snapshot";

/**
 * Счётчик монет существует ради одного инварианта: при неизменных
 * количествах токенов он не шевелится, что бы ни делал рынок. Тест
 * «цены разъехались — метрика та же» ниже — именно тот баг, ради которого
 * метрика переписана; остальное проверяет границы (null ≠ 0, заёмные).
 */

function composition(
  over: Partial<SnapshotCompositionDto> = {},
): SnapshotCompositionDto {
  return { collateral: [], manual: [], ...over };
}

describe("coinCount", () => {
  it("складывает залог по номиналу базового актива", () => {
    // 0.5 WBTC + 0.25 cbBTC = 0.75 BTC: обёртки считаются как есть
    const value = coinCount(
      composition({
        collateral: [
          { symbol: "WBTC", chain: "ethereum", quantity: "0.5" },
          { symbol: "cbBTC", chain: "base", quantity: "0.25" },
        ],
      }),
    );
    expect(value).toBeCloseTo(0.75, 12);
  });

  it("wstETH идёт за 1 ETH — осознанное занижение, а не ошибка", () => {
    // Решение движка: номинал вместо курса LST. Курс вернул бы ценовой
    // дрейф, ради устранения которого метрика и переписана
    const value = coinCount(
      composition({
        collateral: [
          { symbol: "wstETH", chain: "ethereum", quantity: "1" },
          { symbol: "WETH", chain: "arbitrum", quantity: "2" },
        ],
      }),
    );
    expect(value).toBe(3);
  });

  it("ручные записи входят в счётчик в единицах категории", () => {
    const value = coinCount(
      composition({
        collateral: [{ symbol: "WBTC", chain: "ethereum", quantity: "1" }],
        manual: [{ label: "Биржа", amount: "0.4" }],
      }),
    );
    expect(value).toBeCloseTo(1.4, 12);
  });

  it("свободные балансы складываются вместе с залогом", () => {
    const value = coinCount(
      composition({
        collateral: [{ symbol: "WBTC", chain: "ethereum", quantity: "1" }],
        free: [
          { symbol: "WBTC", chain: "arbitrum", quantity: "0.2", funds: "own" },
          { symbol: "cbBTC", chain: "base", quantity: "0.05", funds: null },
        ],
      }),
    );
    expect(value).toBeCloseTo(1.25, 12);
  });

  it("заёмные свободные в категорию не входят (Фаза 7)", () => {
    const value = coinCount(
      composition({
        free: [
          { symbol: "WBTC", chain: "ethereum", quantity: "1", funds: "own" },
          {
            symbol: "WBTC",
            chain: "arbitrum",
            quantity: "5",
            funds: "borrowed",
          },
        ],
      }),
    );
    expect(value).toBe(1);
  });

  it("неразмеченный свободный баланс считается своим", () => {
    const value = coinCount(
      composition({
        free: [{ symbol: "ETH", chain: "ethereum", quantity: "2", funds: null }],
      }),
    );
    expect(value).toBe(2);
  });

  it("состава нет — null, а не ноль", () => {
    // «Не записали» и «монет не было» на графике накопления — разные вещи
    expect(coinCount(null)).toBeNull();
    expect(coinCount(undefined)).toBeNull();
  });

  it("пустой состав — настоящий ноль", () => {
    expect(coinCount(composition())).toBe(0);
  });

  it("состав без free — эпоха до чтения балансов, не ноль по категории", () => {
    // Поля free нет вовсе: точка снята до Фазы 7, и залог с ручными
    // записями были полным составом своей эпохи
    const value = coinCount(
      composition({
        collateral: [{ symbol: "WBTC", chain: "ethereum", quantity: "0.3" }],
      }),
    );
    expect(value).toBeCloseTo(0.3, 12);
  });
});

describe("coinCountOf", () => {
  const items = [
    {
      category: "btc" as const,
      composition: composition({
        collateral: [{ symbol: "WBTC", chain: "ethereum", quantity: "1" }],
      }),
    },
    { category: "eth" as const, composition: null },
  ];

  it("берёт состав своей категории", () => {
    expect(coinCountOf(items, "btc")).toBe(1);
  });

  it("категория без состава — null", () => {
    expect(coinCountOf(items, "eth")).toBeNull();
  });

  it("категории нет в точке вовсе — тоже null, не ноль", () => {
    expect(coinCountOf(items, "stable")).toBeNull();
  });
});

/**
 * Сквозная проверка: движок → снепшот → счётчик. Количества токенов те же,
 * цены разъехались — счётчик обязан совпасть до последнего знака, а старый
 * quantity (эквивалент по цене) обязан разойтись: иначе тест ничего не ловит.
 */
describe("счётчик монет не зависит от цен", () => {
  function pricesAt(map: Record<string, number>): Map<string, PriceInput> {
    return new Map(
      Object.entries(map).map(([id, priceUsd]) => [
        id,
        { priceUsd, fetchedAt: "2026-08-10T03:00:00.000Z", stale: false },
      ]),
    );
  }

  /** Один и тот же портфель, оцененный данным набором цен. */
  function snapshotAt(prices: Map<string, PriceInput>): SnapshotSource {
    const portfolio = computePortfolio({
      collateral: [
        {
          walletId: "w1",
          walletLabel: "Основной",
          chain: "ethereum",
          symbol: "WBTC",
          category: "btc",
          coingeckoId: "wrapped-bitcoin",
          quantity: "0.8",
        },
        {
          walletId: "w1",
          walletLabel: "Основной",
          chain: "ethereum",
          symbol: "wstETH",
          category: "eth",
          coingeckoId: "wrapped-steth",
          quantity: "4",
        },
      ],
      manual: [
        { id: "m1", category: "btc", label: "Биржа", amount: "0.1" },
        { id: "m2", category: "stable", label: "Pendle PT", amount: "5000" },
      ],
      free: [
        {
          key: "w1:arbitrum:native",
          walletId: "w1",
          walletLabel: "Основной",
          chain: "arbitrum",
          token: "native",
          symbol: "ETH",
          category: "eth",
          coingeckoId: "ethereum",
          quantity: "1.5",
          funds: null,
          updatedAt: "2026-08-10T03:00:00.000Z",
        },
        {
          key: "w1:arbitrum:0xusdc",
          walletId: "w1",
          walletLabel: "Основной",
          chain: "arbitrum",
          token: "0xusdc",
          symbol: "USDC",
          category: "stable",
          coingeckoId: "usd-coin",
          quantity: "2000",
          funds: "borrowed",
          updatedAt: "2026-08-10T03:00:00.000Z",
        },
      ],
      targets: {},
      prices,
    });
    return {
      totalUsd: portfolio.totalUsd,
      rows: portfolio.rows,
      chains: [],
      freeBorrowedUsd: portfolio.freeBorrowedUsd,
    };
  }

  // День 1 и день 2: владелец не делал ничего, двигался только рынок.
  // Разъехались и цены категорий, и спред обёрток к базовому активу —
  // ровно то, из-за чего колонка ползла на 0,1–0,3% в день
  const day1 = buildSnapshotRows(
    snapshotAt(
      pricesAt({
        bitcoin: 100_000,
        "wrapped-bitcoin": 99_900,
        ethereum: 4_000,
        "wrapped-steth": 4_960,
        "usd-coin": 1,
      }),
    ),
  );
  const day2 = buildSnapshotRows(
    snapshotAt(
      pricesAt({
        bitcoin: 112_500,
        "wrapped-bitcoin": 112_700,
        ethereum: 3_700,
        "wrapped-steth": 4_625,
        "usd-coin": 1,
      }),
    ),
  );

  function coins(build: ReturnType<typeof buildSnapshotRows>, category: string) {
    const item = build.items.find((i) => i.category === category)!;
    return coinCount(item.composition);
  }

  it("BTC: 0.8 WBTC + 0.1 вручную = 0.9 оба дня", () => {
    expect(coins(day1, "btc")).toBeCloseTo(0.9, 12);
    expect(coins(day2, "btc")).toBeCloseTo(0.9, 12);
    expect(coins(day2, "btc")).toBe(coins(day1, "btc"));
  });

  it("ETH: 4 wstETH + 1.5 свободного ETH = 5.5 оба дня", () => {
    expect(coins(day1, "eth")).toBeCloseTo(5.5, 12);
    expect(coins(day2, "eth")).toBe(coins(day1, "eth"));
  });

  it("стейблы: ручные $5 000, заёмные $2 000 не в счёт", () => {
    expect(coins(day1, "stable")).toBe(5_000);
    expect(coins(day2, "stable")).toBe(5_000);
  });

  it("а вот стоимость и старый quantity за эти два дня разъехались", () => {
    // Контроль чувствительности теста: если бы цены не двигались,
    // совпадение счётчика ничего не доказывало бы
    const btc1 = day1.items.find((i) => i.category === "btc")!;
    const btc2 = day2.items.find((i) => i.category === "btc")!;
    expect(btc2.valueUsd).not.toBeCloseTo(btc1.valueUsd, 6);
    expect(btc2.quantity).not.toBeCloseTo(btc1.quantity!, 6);

    const eth1 = day1.items.find((i) => i.category === "eth")!;
    const eth2 = day2.items.find((i) => i.category === "eth")!;
    expect(eth2.quantity).not.toBeCloseTo(eth1.quantity!, 6);
  });

  it("счётчик игнорирует даже полное отсутствие цены категории", () => {
    // Нет цены — старый quantity становится null и день пропадал из графика;
    // монеты на кошельке при этом никуда не делись
    const noPrice = buildSnapshotRows(snapshotAt(pricesAt({ "usd-coin": 1 })));
    const btc = noPrice.items.find((i) => i.category === "btc")!;
    expect(btc.quantity).toBeNull();
    expect(coinCount(btc.composition)).toBeCloseTo(0.9, 12);
  });
});
