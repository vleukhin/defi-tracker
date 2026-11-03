import "server-only";
import {
  encodeAbiParameters,
  erc20Abi,
  formatUnits,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { closeVanishedPositions } from "./closures";
import { getChainClients, type ChainId } from "./config";
import {
  getGmxApiData,
  gmxMidPriceUsd,
  type GmxApiData,
  type GmxMarket,
} from "@/lib/prices/gmx-api";
import { coingeckoIdForSymbol } from "@/lib/prices/symbol-coingecko";
import { logApiCall } from "@/lib/metrics";

/**
 * GM-пулы GMX v2 на Arbitrum (S5.1).
 *
 * Оценка позиции берется у Reader.getMarketTokenPrice, а НЕ как сумма
 * стоимостей long/short-компонентов: держатель GM выступает контрагентом
 * трейдеров, поэтому в стоимость пула входит их незакрытый PnL и накопленные
 * комиссии. Сумма компонентов игнорировала бы ровно ту величину, ради которой
 * эту фазу и делаем.
 *
 * Тот же вызов отдает MarketPoolValueInfo с longTokenAmount/shortTokenAmount —
 * из них и получается декомпозиция позиции по доле в totalSupply.
 *
 * Проверено живым вызовом на рынке ETH/USD [ETH-USDC]:
 * poolValue / totalSupply сходится с возвращаемой ценой GM до 4 знаков.
 *
 * --- Рынки на одном активе ---
 *
 * У GMX есть рынки, где длинный и короткий токены совпадают: BTC/USD
 * [BTC-BTC] (на Arbitrum это [WBTC.b-WBTC.b] и [tBTC-tBTC]), ETH/USD
 * [ETH-ETH]. Держатель такого пула стоит в базовом активе целиком, стейблов
 * в пуле нет вовсе.
 *
 * Reader при этом по-прежнему возвращает longTokenAmount и shortTokenAmount
 * отдельно, но это не две стороны, а ПОЛОВИНЫ одного запаса: в
 * MarketUtils.getPoolAmount при longToken == shortToken делитель равен двум
 * (getPoolDivisor), и обе величины выходят по половине реального количества.
 * Два компонента по 50% соврали бы дважды — показали бы сторону, которой
 * нет, и половину количества вместо целого. Поэтому такой рынок даёт один
 * компонент без стороны и с суммой половин.
 */

/** GM-пулы читаются только на Arbitrum — там развернут GMX v2. */
export const GMX_CHAIN: ChainId = "arbitrum";
export const GMX_SOURCE = "gmx_v2" as const;

export const GMX_READER = "0x470fbC46bcC0f16532691Df360A07d8Bf5ee0789" as const;
export const GMX_DATASTORE =
  "0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8" as const;

/** GM-токены всегда 18 знаков; цена рынка — фикс-поинт 1e30. */
const GM_DECIMALS = 18;
const GMX_PRICE_SCALE = 10 ** 30;

/**
 * Ключи DataStore — keccak256(abi.encode("ИМЯ")), именно abi.encode, а не
 * encodePacked (Keys.sol GMX). MAX_PNL_FACTOR_FOR_TRADERS — то, что показывает
 * сам интерфейс GMX: оценка «сколько стоит моя доля прямо сейчас».
 */
export const MAX_PNL_FACTOR_FOR_TRADERS = keccak256(
  encodeAbiParameters([{ type: "string" }], ["MAX_PNL_FACTOR_FOR_TRADERS"]),
);

/**
 * Мультичейн-баланс: GM, купленный кросс-чейном, лежит НЕ в кошельке.
 *
 * Покупка с другой сети (Stargate → LayerZeroProvider GMX → DepositVault)
 * зачисляет GM в общее хранилище GMX, а право кошелька на них живёт
 * записью в DataStore. `balanceOf` у кошелька по такой позиции отдаёт ноль,
 * и без этой записи она невидима целиком: не «оценка неизвестна», а
 * «позиции нет», хотя деньги вложены.
 *
 * Ключ — Keys.multichainBalanceKey: keccak256(abi.encode(MULTICHAIN_BALANCE,
 * account, token)), где сама константа тоже abi.encode от строки.
 */
export const MULTICHAIN_BALANCE = keccak256(
  encodeAbiParameters([{ type: "string" }], ["MULTICHAIN_BALANCE"]),
);

export function multichainBalanceKey(account: Address, token: string): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }],
      [MULTICHAIN_BALANCE, account, token as Address],
    ),
  );
}

export const dataStoreAbi = [
  {
    name: "getUint",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "key", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const readerAbi = [
  {
    name: "getMarketTokenPrice",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "dataStore", type: "address" },
      {
        name: "market",
        type: "tuple",
        components: [
          { name: "marketToken", type: "address" },
          { name: "indexToken", type: "address" },
          { name: "longToken", type: "address" },
          { name: "shortToken", type: "address" },
        ],
      },
      {
        name: "indexTokenPrice",
        type: "tuple",
        components: [
          { name: "min", type: "uint256" },
          { name: "max", type: "uint256" },
        ],
      },
      {
        name: "longTokenPrice",
        type: "tuple",
        components: [
          { name: "min", type: "uint256" },
          { name: "max", type: "uint256" },
        ],
      },
      {
        name: "shortTokenPrice",
        type: "tuple",
        components: [
          { name: "min", type: "uint256" },
          { name: "max", type: "uint256" },
        ],
      },
      { name: "pnlFactorType", type: "bytes32" },
      { name: "maximize", type: "bool" },
    ],
    outputs: [
      { name: "", type: "int256" },
      {
        name: "",
        type: "tuple",
        components: [
          { name: "poolValue", type: "int256" },
          { name: "longPnl", type: "int256" },
          { name: "shortPnl", type: "int256" },
          { name: "netPnl", type: "int256" },
          { name: "longTokenAmount", type: "uint256" },
          { name: "shortTokenAmount", type: "uint256" },
          { name: "longTokenUsd", type: "uint256" },
          { name: "shortTokenUsd", type: "uint256" },
          { name: "totalBorrowingFees", type: "uint256" },
          { name: "borrowingFeePoolFactor", type: "uint256" },
          { name: "impactPoolAmount", type: "uint256" },
          { name: "lentImpactPoolAmount", type: "uint256" },
        ],
      },
    ],
  },
] as const;

/** Компонент GM-позиции: часть пула, приходящаяся на долю пользователя. */
export interface GmComponent {
  /**
   * Сторона пула. null — рынок на одном активе (BTC/USD [BTC-BTC]): сторон
   * у него нет, и компонент у позиции один (см. шапку модуля).
   */
  side: "long" | "short" | null;
  symbol: string;
  address: string;
  coingeckoId: string | null;
  /** Количество базового токена, приходящееся на позицию. */
  quantity: number;
  valueUsd: number;
}

export interface GmPositionReading {
  /** Адрес GM-токена — он же external_id. */
  marketToken: Address;
  marketName: string;
  /** Баланс GM в сыром виде (18 знаков): кошелёк плюс мультичейн-кредит. */
  raw: bigint;
  /**
   * Часть `raw`, которая лежит не в кошельке, а в хранилище GMX
   * (кросс-чейн покупка, см. MULTICHAIN_BALANCE). Ноль — обычная позиция.
   */
  multichainRaw: bigint;
  quantity: number;
  /** Цена одного GM в долларах (оракул GMX). */
  gmPriceUsd: number;
  valueUsd: number;
  components: GmComponent[];
}

export interface GmxChainStatus {
  chain: ChainId;
  /** false = не прочитано: значение НЕизвестно, а не «позиций нет». */
  ok: boolean;
  error?: string;
  positions: GmPositionReading[];
  /** Рынки, чью цену получить не удалось: позиция есть, оценки нет. */
  unpriced: { marketToken: string; marketName: string; reason: string }[];
}

type MulticallResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error; result?: undefined };

/** Узкий интерфейс клиента — читатель тестируется без сети. */
export interface GmxRpcClient {
  multicall(args: {
    contracts: readonly {
      address: Address;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- контракты гетерогенные: erc20 + Reader
      abi: any;
      functionName: string;
      args: readonly unknown[];
    }[];
    allowFailure: true;
  }): Promise<readonly MulticallResult[]>;
}

export interface GmxReadOptions {
  client?: GmxRpcClient;
  apiData?: GmxApiData;
  logCall?: typeof logApiCall;
}

/** Символ токена по адресу: в /tokens он есть, но нам удобнее по адресу. */
function symbolFromMarketName(market: GmxMarket, side: "long" | "short"): string {
  // Имя рынка вида «ETH/USD [ETH-USDC]» — в скобках long-short пара.
  // У рынка на одном активе («ETH/USD [ETH-ETH]») обе половины названы
  // одинаково, поэтому сторона там безразлична.
  const inside = market.name.match(/\[([^\]]+)\]/)?.[1];
  const parts = inside?.split("-") ?? [];
  const symbol = side === "long" ? parts[0] : parts[1];
  return symbol?.trim() ?? side;
}

/** Рынок на одном активе: длинный и короткий токены — один и тот же. */
export function isSingleAssetMarket(market: GmxMarket): boolean {
  return market.longToken.toLowerCase() === market.shortToken.toLowerCase();
}

interface PoolValueInfo {
  longTokenAmount: bigint;
  shortTokenAmount: bigint;
}

function isPriceTuple(
  value: unknown,
): value is readonly [bigint, PoolValueInfo] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "bigint" &&
    value[1] !== null &&
    typeof value[1] === "object" &&
    "longTokenAmount" in value[1]
  );
}

/**
 * GM-позиции кошелька: два multicall'а. Первый — balanceOf по всем рынкам
 * (их около 130, но это один RPC-запрос). Второй — totalSupply и цена только
 * по рынкам с ненулевым балансом, чтобы не гонять 130 тяжелых вызовов.
 */
export async function readWalletGmx(
  wallet: Address,
  opts: GmxReadOptions = {},
): Promise<GmxChainStatus> {
  const logCall = opts.logCall ?? logApiCall;
  const client =
    opts.client ??
    ((getChainClients() as unknown as Record<ChainId, GmxRpcClient>)[GMX_CHAIN]);

  let api: GmxApiData;
  try {
    api = opts.apiData ?? (await getGmxApiData({ logCall }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[gmx] API недоступен: ${message}`);
    return {
      chain: GMX_CHAIN,
      ok: false,
      error: `GMX API: ${message}`,
      positions: [],
      unpriced: [],
    };
  }

  const markets = [...api.markets.values()];
  if (markets.length === 0) {
    return { chain: GMX_CHAIN, ok: true, positions: [], unpriced: [] };
  }

  try {
    // Две величины на рынок: GM в кошельке и GM, зачисленные кошельку
    // внутри GMX (кросс-чейн покупка). Обе в одном multicall'е.
    const balances = await client.multicall({
      contracts: markets.flatMap((m) => [
        {
          address: m.marketToken as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet] as const,
        },
        {
          address: GMX_DATASTORE as Address,
          abi: dataStoreAbi,
          functionName: "getUint",
          args: [multichainBalanceKey(wallet, m.marketToken)] as const,
        },
      ]),
      allowFailure: true,
    });
    void logCall("alchemy", `gmx:balances`, { units: 1 });

    const amountOf = (res: MulticallResult | undefined): bigint | null =>
      res && res.status === "success" && typeof res.result === "bigint"
        ? res.result
        : null;

    const held: { market: GmxMarket; raw: bigint; multichainRaw: bigint }[] = [];
    const unreadable: { market: GmxMarket; known: bigint }[] = [];
    markets.forEach((market, i) => {
      const inWallet = amountOf(balances[i * 2]);
      const inGmx = amountOf(balances[i * 2 + 1]);

      if (inWallet !== null && inGmx !== null) {
        const raw = inWallet + inGmx;
        if (raw > 0n) held.push({ market, raw, multichainRaw: inGmx });
        return;
      }
      // Прочитана половина: размер позиции неизвестен. Положительная
      // половина означает, что позиция ЕСТЬ, и молчать о ней нельзя —
      // иначе она уйдёт в закрытые как исчезнувшая. Обе половины упали —
      // ведём себя как раньше: рынков сотня, и «неизвестно» по каждому
      // было бы шумом, неотличимым от пустого кошелька.
      const known = inWallet ?? inGmx;
      if (known !== null && known > 0n) unreadable.push({ market, known });
    });

    if (held.length === 0 && unreadable.length === 0) {
      return { chain: GMX_CHAIN, ok: true, positions: [], unpriced: [] };
    }

    // Цена и totalSupply только по рынкам, где реально есть баланс
    const priceCalls = held.flatMap(({ market }) => {
      const index = api.prices.get(market.indexToken.toLowerCase());
      const long = api.prices.get(market.longToken.toLowerCase());
      const short = api.prices.get(market.shortToken.toLowerCase());
      // Нет оракульной цены — вызов не отправляем: он все равно ревертнет
      const priceArgs =
        index && long && short
          ? ([
              GMX_DATASTORE,
              {
                marketToken: market.marketToken,
                indexToken: market.indexToken,
                longToken: market.longToken,
                shortToken: market.shortToken,
              },
              index,
              long,
              short,
              MAX_PNL_FACTOR_FOR_TRADERS,
              false,
            ] as const)
          : null;
      return [
        {
          address: market.marketToken as Address,
          abi: erc20Abi,
          functionName: "totalSupply",
          args: [] as const,
        },
        ...(priceArgs
          ? [
              {
                address: GMX_READER as Address,
                abi: readerAbi,
                functionName: "getMarketTokenPrice",
                args: priceArgs,
              },
            ]
          : []),
      ];
    });

    const priceResults = await client.multicall({
      contracts: priceCalls,
      allowFailure: true,
    });
    void logCall("alchemy", `gmx:prices`, { units: 1 });

    const positions: GmPositionReading[] = [];
    const unpriced: GmxChainStatus["unpriced"] = [];
    let cursor = 0;

    for (const { market, raw, multichainRaw } of held) {
      const supplyRes = priceResults[cursor++];
      const hasPriceCall =
        api.prices.has(market.indexToken.toLowerCase()) &&
        api.prices.has(market.longToken.toLowerCase()) &&
        api.prices.has(market.shortToken.toLowerCase());
      const priceRes = hasPriceCall ? priceResults[cursor++] : undefined;

      const quantity = Number(formatUnits(raw, GM_DECIMALS));

      if (
        !priceRes ||
        priceRes.status !== "success" ||
        !isPriceTuple(priceRes.result) ||
        supplyRes.status !== "success" ||
        typeof supplyRes.result !== "bigint" ||
        supplyRes.result === 0n
      ) {
        unpriced.push({
          marketToken: market.marketToken.toLowerCase(),
          marketName: market.name,
          reason: hasPriceCall
            ? "getMarketTokenPrice не прочитан"
            : "нет оракульной цены токена",
        });
        continue;
      }

      const [gmPriceRaw, info] = priceRes.result;
      const totalSupply = supplyRes.result;
      const gmPriceUsd = Number(gmPriceRaw) / GMX_PRICE_SCALE;
      const valueUsd = quantity * gmPriceUsd;

      // Доля в пуле = баланс / totalSupply; считаем в bigint-долях, чтобы
      // не терять точность на больших supply
      const shareNum = Number(raw) / Number(totalSupply);

      const component = (
        side: "long" | "short" | null,
        tokenAddr: string,
        poolAmount: bigint,
      ): GmComponent => {
        const address = tokenAddr.toLowerCase();
        const decimals = api.decimals.get(address) ?? 18;
        const qty = Number(formatUnits(poolAmount, decimals)) * shareNum;
        const price = api.prices.get(address);
        const symbol = symbolFromMarketName(market, side ?? "long");
        return {
          side,
          symbol,
          address,
          coingeckoId: coingeckoIdForSymbol(symbol),
          quantity: qty,
          valueUsd: price ? qty * gmxMidPriceUsd(price, decimals) : 0,
        };
      };

      // Рынок на одном активе — один компонент без стороны, количество
      // складывается из обеих половин (см. шапку модуля)
      const components: GmComponent[] = isSingleAssetMarket(market)
        ? [
            component(
              null,
              market.longToken,
              info.longTokenAmount + info.shortTokenAmount,
            ),
          ]
        : [
            component("long", market.longToken, info.longTokenAmount),
            component("short", market.shortToken, info.shortTokenAmount),
          ];

      positions.push({
        marketToken: market.marketToken as Address,
        marketName: market.name,
        raw,
        multichainRaw,
        quantity,
        gmPriceUsd,
        valueUsd,
        components,
      });
    }

    for (const { market } of unreadable) {
      unpriced.push({
        marketToken: market.marketToken.toLowerCase(),
        marketName: market.name,
        reason: "баланс прочитан только наполовину",
      });
    }

    return { chain: GMX_CHAIN, ok: true, positions, unpriced };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logCall("alchemy", `gmx:balances`, { units: 1, ok: false });
    console.warn(`[gmx] чтение не удалось: ${message}`);
    return {
      chain: GMX_CHAIN,
      ok: false,
      error: message,
      positions: [],
      unpriced: [],
    };
  }
}

/** JSON-полезная нагрузка GM-позиции. */
export interface GmPositionPayload {
  kind: "gmx_gm";
  marketName: string;
  marketToken: string;
  gmPriceUsd: number;
  raw: string;
  /** Часть `raw` в хранилище GMX; строки до этой поддержки его не хранят. */
  multichainRaw?: string;
  components: GmComponent[];
}

/**
 * Запись GM-позиций. Как и везде: упавшее чтение кэш не трогает, исчезнувшие
 * позиции уходят в архив закрытых и удаляются только после успешного ответа
 * сети.
 */
export async function persistGmxPositions(
  admin: SupabaseClient,
  userId: string,
  walletId: string,
  status: GmxChainStatus,
): Promise<void> {
  if (!status.ok) return;
  const nowIso = new Date().toISOString();

  const upserts = status.positions.map((p) => ({
    wallet_id: walletId,
    protocol: GMX_SOURCE,
    chain: status.chain,
    external_id: p.marketToken.toLowerCase(),
    quantity: p.quantity.toString(),
    value_usd: p.valueUsd,
    payload: {
      kind: "gmx_gm" as const,
      marketName: p.marketName,
      marketToken: p.marketToken.toLowerCase(),
      gmPriceUsd: p.gmPriceUsd,
      raw: p.raw.toString(),
      multichainRaw: p.multichainRaw.toString(),
      components: p.components,
    },
    updated_at: nowIso,
  }));

  if (upserts.length > 0) {
    const { error } = await admin
      .from("protocol_positions")
      .upsert(upserts, { onConflict: "wallet_id,protocol,chain,external_id" });
    if (error) throw new Error(`protocol_positions (gmx) upsert: ${error.message}`);
  }

  // Позиции, которые не удалось оценить, НЕ удаляем: они существуют,
  // просто цена неизвестна — удаление выглядело бы как закрытие позиции.
  const keep = [
    ...status.positions.map((p) => p.marketToken.toLowerCase()),
    ...status.unpriced.map((u) => u.marketToken),
  ];
  await closeVanishedPositions(admin, {
    userId,
    walletId,
    protocol: GMX_SOURCE,
    chain: status.chain,
    aliveExternalIds: keep,
    closedAt: nowIso,
  });
}

/** Статус чтения GMX — отдельный источник (может упасть при живом Aave). */
export async function persistGmxStatus(
  admin: SupabaseClient,
  walletId: string,
  status: GmxChainStatus,
): Promise<void> {
  const { error } = await admin.from("chain_read_status").upsert(
    [
      {
        wallet_id: walletId,
        source: GMX_SOURCE,
        chain: status.chain,
        ok: status.ok,
        error: status.error ?? null,
        checked_at: new Date().toISOString(),
      },
    ],
    { onConflict: "wallet_id,source,chain" },
  );
  if (error) throw new Error(`chain_read_status (gmx) upsert: ${error.message}`);
}
