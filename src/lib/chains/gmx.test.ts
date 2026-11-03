import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import {
  GMX_DATASTORE,
  MULTICHAIN_BALANCE,
  isSingleAssetMarket,
  multichainBalanceKey,
  readWalletGmx,
  type GmxRpcClient,
} from "./gmx";
import { usdToGmxPrice, type GmxApiData, type GmxMarket } from "@/lib/prices/gmx-api";

/**
 * Читатель GM-пулов — разбор состава позиции.
 *
 * Ради чего тест: у рынка на одном активе (BTC/USD [BTC-BTC], ETH/USD
 * [ETH-ETH]) Reader отдаёт longTokenAmount и shortTokenAmount по ПОЛОВИНЕ
 * одного запаса — в MarketUtils при longToken == shortToken делитель равен
 * двум. Два компонента по 50% показали бы сторону, которой нет, и половину
 * количества; здесь проверяется, что половины складываются в один компонент
 * без стороны, а двусторонний рынок разбирается как раньше.
 *
 * Второе: GM, купленный кросс-чейном, в кошелёк не приходит — он зачислен
 * кошельку внутри GMX (DataStore, MULTICHAIN_BALANCE). По `balanceOf`
 * такая позиция равна нулю, и читатель обязан спросить и DataStore.
 */

const WALLET = "0x1111111111111111111111111111111111111111" as Address;

const WBTC = "0x00000000000000000000000000000000000000b1";
const BTC_INDEX = "0x00000000000000000000000000000000000000b2";
const WETH = "0x00000000000000000000000000000000000000e1";
const USDC = "0x00000000000000000000000000000000000000c1";

const DECIMALS: Record<string, number> = {
  [WBTC]: 8,
  [BTC_INDEX]: 8,
  [WETH]: 18,
  [USDC]: 6,
};
const PRICES_USD: Record<string, number> = {
  [WBTC]: 100_000,
  [BTC_INDEX]: 100_000,
  [WETH]: 3_000,
  [USDC]: 1,
};
const SYMBOLS: Record<string, string> = {
  [WBTC]: "WBTC.b",
  [BTC_INDEX]: "BTC",
  [WETH]: "ETH",
  [USDC]: "USDC",
};

/** Рынок на одном активе: длинная и короткая стороны — один токен. */
const SINGLE: GmxMarket = {
  name: "BTC/USD [WBTC.b-WBTC.b]",
  marketToken: "0x00000000000000000000000000000000000000a1",
  indexToken: BTC_INDEX,
  longToken: WBTC,
  shortToken: WBTC,
};

const PAIR: GmxMarket = {
  name: "ETH/USD [ETH-USDC]",
  marketToken: "0x00000000000000000000000000000000000000a2",
  indexToken: WETH,
  longToken: WETH,
  shortToken: USDC,
};

function apiData(markets: GmxMarket[]): GmxApiData {
  return {
    decimals: new Map(Object.entries(DECIMALS)),
    symbols: new Map(Object.entries(SYMBOLS)),
    prices: new Map(
      Object.entries(PRICES_USD).map(([address, price]) => {
        const raw = usdToGmxPrice(price, DECIMALS[address]);
        return [address, { min: raw, max: raw }];
      }),
    ),
    markets: new Map(markets.map((m) => [m.marketToken, m])),
  };
}

/** Количество токена в сыром виде по его decimals. */
function raw(address: string, amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS[address]));
}

/** Ответ multicall'а: число или упавший вызов. */
type Leg = bigint | "fail";

const leg = (value: Leg) =>
  value === "fail"
    ? { status: "failure" as const, error: new Error("revert") }
    : { status: "success" as const, result: value };

/**
 * Клиент на два multicall'а. Первый — по два ответа на рынок: баланс
 * кошелька и мультичейн-кредит в DataStore. Второй — totalSupply и цена
 * по каждому рынку с ненулевой суммой.
 */
function client(
  balances: { wallet: Leg; gmx?: Leg }[],
  priced: {
    totalSupply: bigint;
    gmPriceUsd: number;
    longTokenAmount: bigint;
    shortTokenAmount: bigint;
  }[],
): GmxRpcClient {
  const calls = [
    balances.flatMap((b) => [leg(b.wallet), leg(b.gmx ?? 0n)]),
    priced.flatMap((p) => [
      { status: "success" as const, result: p.totalSupply },
      {
        status: "success" as const,
        result: [
          BigInt(Math.round(p.gmPriceUsd * 1e8)) * 10n ** 22n,
          {
            longTokenAmount: p.longTokenAmount,
            shortTokenAmount: p.shortTokenAmount,
          },
        ],
      },
    ]),
  ];
  let call = 0;
  return { multicall: vi.fn().mockImplementation(() => calls[call++]) };
}

/** Пул ETH/USDC с долей кошелька 10%: 20 ETH и 60 000 USDC на весь пул. */
const PAIR_POOL = {
  totalSupply: 100n * 10n ** 18n,
  gmPriceUsd: 2,
  longTokenAmount: 20n * 10n ** 18n,
  shortTokenAmount: 60_000n * 10n ** 6n,
};

const noLog = vi.fn();

describe("isSingleAssetMarket", () => {
  it("рынок на одном активе отличается совпадением сторон", () => {
    expect(isSingleAssetMarket(SINGLE)).toBe(true);
    expect(isSingleAssetMarket(PAIR)).toBe(false);
  });
});

describe("readWalletGmx: состав позиции", () => {
  it("у рынка на одном активе половины складываются в один компонент", async () => {
    // В пуле 10 WBTC.b; Reader показывает их двумя половинами по 5.
    // Доля кошелька — 10%, значит на позицию приходится ровно 1 WBTC.b
    const status = await readWalletGmx(WALLET, {
      apiData: apiData([SINGLE]),
      logCall: noLog,
      client: client(
        [{ wallet: 10n * 10n ** 18n }],
        [
          {
            totalSupply: 100n * 10n ** 18n,
            gmPriceUsd: 1.5,
            longTokenAmount: raw(WBTC, 5),
            shortTokenAmount: raw(WBTC, 5),
          },
        ],
      ),
    });

    expect(status.ok).toBe(true);
    expect(status.unpriced).toEqual([]);
    expect(status.positions).toHaveLength(1);

    const position = status.positions[0];
    expect(position.quantity).toBe(10);
    expect(position.gmPriceUsd).toBeCloseTo(1.5, 9);
    expect(position.valueUsd).toBeCloseTo(15, 9);
    expect(position.components).toHaveLength(1);
    expect(position.components[0].side).toBeNull();
    expect(position.components[0].symbol).toBe("WBTC.b");
    expect(position.components[0].coingeckoId).toBe("wrapped-bitcoin");
    expect(position.components[0].quantity).toBeCloseTo(1, 9);
    expect(position.components[0].valueUsd).toBeCloseTo(100_000, 4);
  });

  it("двусторонний рынок по-прежнему разбирается на long и short", async () => {
    const status = await readWalletGmx(WALLET, {
      apiData: apiData([PAIR]),
      logCall: noLog,
      client: client(
        [{ wallet: 10n * 10n ** 18n }],
        [
          {
            totalSupply: 100n * 10n ** 18n,
            gmPriceUsd: 2,
            longTokenAmount: raw(WETH, 20),
            shortTokenAmount: raw(USDC, 60_000),
          },
        ],
      ),
    });

    const components = status.positions[0].components;
    expect(components.map((c) => c.side)).toEqual(["long", "short"]);
    expect(components[0].symbol).toBe("ETH");
    expect(components[0].quantity).toBeCloseTo(2, 9);
    expect(components[1].symbol).toBe("USDC");
    expect(components[1].quantity).toBeCloseTo(6_000, 9);
  });
});

describe("readWalletGmx: GM внутри GMX (кросс-чейн покупка)", () => {
  it("ключ мультичейн-баланса совпадает с живым DataStore", () => {
    // Сверено на Arbitrum: под этим ключом лежит ETH-кредит реального
    // кошелька. Поменяется кодирование — тест скажет раньше, чем пропадут
    // позиции на экране
    expect(MULTICHAIN_BALANCE).toBe(
      "0x3150e34ed2bc2912771bc28ae1945c3db4b3312273ef8f506b4064ad77528236",
    );
  });

  it("DataStore спрашивается по каждому рынку, ключом кошелька и рынка", async () => {
    const rpc = client([{ wallet: 0n }], []);
    await readWalletGmx(WALLET, {
      apiData: apiData([PAIR]),
      logCall: noLog,
      client: rpc,
    });
    const first = vi.mocked(rpc.multicall).mock.calls[0][0].contracts;
    expect(first).toHaveLength(2);
    expect(first[1]).toMatchObject({
      address: GMX_DATASTORE,
      functionName: "getUint",
      args: [multichainBalanceKey(WALLET, PAIR.marketToken)],
    });
  });

  it("позиция, которой нет в кошельке, читается из DataStore", async () => {
    // Ровно случай из жизни: balanceOf = 0, а GM куплены с Ethereum
    const status = await readWalletGmx(WALLET, {
      apiData: apiData([PAIR]),
      logCall: noLog,
      client: client([{ wallet: 0n, gmx: 10n * 10n ** 18n }], [PAIR_POOL]),
    });

    expect(status.positions).toHaveLength(1);
    const position = status.positions[0];
    expect(position.quantity).toBe(10);
    expect(position.multichainRaw).toBe(10n * 10n ** 18n);
    expect(position.valueUsd).toBeCloseTo(20, 9);
    // Доля в пуле — от суммы, иначе состав вышел бы нулевым
    expect(position.components[0].quantity).toBeCloseTo(2, 9);
  });

  it("кошелёк и GMX складываются в одну позицию рынка", async () => {
    const status = await readWalletGmx(WALLET, {
      apiData: apiData([PAIR]),
      logCall: noLog,
      client: client(
        [{ wallet: 4n * 10n ** 18n, gmx: 6n * 10n ** 18n }],
        [PAIR_POOL],
      ),
    });

    expect(status.positions).toHaveLength(1);
    expect(status.positions[0].quantity).toBe(10);
    expect(status.positions[0].raw).toBe(10n * 10n ** 18n);
    expect(status.positions[0].multichainRaw).toBe(6n * 10n ** 18n);
  });

  it("половина прочитана и она не пуста — позиция есть, размер неизвестен", async () => {
    // Записать в позицию одну прочитанную часть — занизить её молча;
    // промолчать — отправить позицию в архив закрытых. Остаётся «есть,
    // но без оценки»: unpriced держит строку живой
    const status = await readWalletGmx(WALLET, {
      apiData: apiData([PAIR]),
      logCall: noLog,
      client: client([{ wallet: 4n * 10n ** 18n, gmx: "fail" }], []),
    });

    expect(status.ok).toBe(true);
    expect(status.positions).toEqual([]);
    expect(status.unpriced).toEqual([
      {
        marketToken: PAIR.marketToken.toLowerCase(),
        marketName: PAIR.name,
        reason: "баланс прочитан только наполовину",
      },
    ]);
  });

  it("обе половины упали — рынок молчит, как и раньше", async () => {
    const status = await readWalletGmx(WALLET, {
      apiData: apiData([PAIR]),
      logCall: noLog,
      client: client([{ wallet: "fail", gmx: "fail" }], []),
    });
    expect(status.positions).toEqual([]);
    expect(status.unpriced).toEqual([]);
  });
});
