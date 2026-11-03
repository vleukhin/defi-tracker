import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatUnits, type Address } from "viem";
import {
  readWalletAaveCollateral,
  type AaveChainStatus,
} from "@/lib/chains/aave";
import {
  readWalletAaveDebt,
  type AaveDebtChainStatus,
} from "@/lib/chains/aave-debt";
import {
  readWalletAaveSupply,
  type AaveSupplyChainStatus,
} from "@/lib/chains/aave-supply";
import {
  FLUID_SOURCE,
  readWalletFluid,
  type FluidChainStatus,
} from "@/lib/chains/fluid";
import {
  GMX_CHAIN,
  readWalletGmx,
  type GmxChainStatus,
  type GmxRpcClient,
} from "@/lib/chains/gmx";
import {
  readWalletPendle,
  type PendleChainStatus,
} from "@/lib/chains/pendle";
import {
  UNIV3_SOURCE,
  readWalletUniswapV3,
  type UniV3ChainStatus,
} from "@/lib/chains/uniswap-v3";
import { readWalletBalances, type ChainReadStatus } from "@/lib/chains/reader";
import {
  pinChainsAt,
  type HistoricalChains,
  type PinnedBlock,
  type PinnedClient,
} from "@/lib/chains/historical";
import { CHAIN_IDS, type ChainId } from "@/lib/chains/config";
import {
  AAVE_SUPPLY_SOURCE,
  GMX_SOURCE,
  PENDLE_SOURCE,
} from "@/lib/positions/sources";
import { pendleRowOf } from "@/lib/chains/pendle";
import {
  getGmxApiData,
  usdToGmxPrice,
  type GmxApiData,
} from "@/lib/prices/gmx-api";
import { coingeckoIdForSymbol } from "@/lib/prices/symbol-coingecko";
import { getHistoricalCoinPrices } from "@/lib/prices/historical";
import { CATEGORY_COINGECKO_IDS } from "@/lib/prices/coins";
import { isStableSymbol } from "@/lib/stables";
import { symbolCategory } from "@/lib/symbol-category";
import { rawToQuantity } from "./raw-amount";
import type { ChainSource, ChainStatusRow, WalletRow } from "./load";
import type {
  CollateralInput,
  FreeBalanceInput,
  PriceInput,
} from "./portfolio";
import type { DebtHealthRow } from "./debt-health";
import type { PositionRowInput } from "@/lib/positions/positions";
import type { StableBorrowReserveInput } from "@/lib/positions/borrow-rate";
import { STABLE_PRICE_USD } from "@/lib/prices/coins";

/**
 * Сетевая половина портфеля НА МОМЕНТ В ПРОШЛОМ.
 *
 * Собирает то же, что кэши отдают загрузчику за сегодня, только читая
 * контракты на блоке нужной даты (chains/historical.ts) и оценивая
 * прочитанное историческими котировками (prices/historical.ts). Результат —
 * ChainSource, который loadPortfolio принимает вместо кэшей; всё остальное
 * (журнал сделок, «внесено», разметка, зоны) считается тем же кодом, что и
 * на живом пути.
 *
 * В БАЗУ ЗДЕСЬ НЕ ПИШЕТСЯ НИЧЕГО. Кэши отражают «сейчас», и прогон за
 * прошлую дату, уронивший в balances_cache вчерашние балансы, испортил бы
 * текущий экран — ошибка, которую нечем откатить. Поэтому ни один persist*
 * из этого модуля не вызывается, и это главное его правило.
 *
 * Чего восстановить НЕЛЬЗЯ, и это честно видно в результате:
 *   * разметка «свои / заемные» на балансах и доли капитала в позициях —
 *     перезаписываются на месте, истории не имеют; берётся текущая;
 *   * суточные комиссии Uniswap — окно упирается в голову цепочки и
 *     отдаёт no_archive (на стоимость позиции не влияет);
 *   * сети без ключа Alchemy: запасные узлы архива не держат.
 */

/** Что именно удалось прочитать — уходит в отчёт скрипта, а не только в лог. */
export interface HistoricalReadReport {
  /** Блок на каждой сети и промах по времени. */
  blocks: Partial<Record<ChainId, PinnedBlock>>;
  /** Сети, по которым архив недоступен. */
  failedChains: { chain: ChainId; error: string }[];
  /** Монеты, для которых исторической цены не нашлось. */
  missingPrices: string[];
  /** Монеты, чья ближайшая котировка отстоит от момента дальше допуска. */
  offPrices: { id: string; offsetSec: number }[];
}

export interface BuildHistoricalSourceResult {
  source: ChainSource;
  report: HistoricalReadReport;
}

export interface BuildHistoricalSourceOptions {
  /** Подмена прибитых клиентов (тесты). */
  chains?: HistoricalChains;
  /** Подмена справочника GMX (тесты). */
  gmxApiData?: GmxApiData;
}

/**
 * Клиент сети, для которой архив недоступен: любое чтение сразу отказ.
 *
 * Нужен, чтобы отсутствующую сеть не приходилось вычитать особым случаем
 * в каждом из шести читателей. Они и так умеют ровно одно правильное
 * действие при отказе — пометить сеть неотвеченной и не трогать остальные;
 * заглушка просто даёт им повод это сделать, с внятной причиной вместо
 * «cannot read properties of undefined».
 */
function unavailableClient(reason: string): PinnedClient {
  const fail = async (): Promise<never> => {
    throw new Error(reason);
  };
  return {
    getBalance: fail,
    multicall: fail,
    readContract: fail,
    getBlock: fail,
  };
}

/**
 * Прибитые клиенты под «узкий интерфейс» конкретного читателя.
 *
 * Приведение — тот же приём, которым живой путь подаёт читателям viem-клиент
 * (`getChainClients() as unknown as Record<ChainId, AaveRpcClient>`): у каждого
 * читателя свой минимальный интерфейс ради моков в тестах, structural typing
 * их не сводит, а методы за ними стоят одни и те же.
 */
function readerClients<T>(
  clients: Record<ChainId, PinnedClient>,
): Record<ChainId, T> {
  return clients as unknown as Record<ChainId, T>;
}

/** Статус чтения в том виде, в каком его ждёт загрузчик. */
function statusRow(
  chain: string,
  ok: boolean,
  error: string | null,
  checkedAt: string,
): ChainStatusRow {
  return { chain, ok, error, checked_at: checkedAt };
}

/**
 * Справочник GMX с ИСТОРИЧЕСКИМИ ценами оракула.
 *
 * GM-пул оценивается вызовом getMarketTokenPrice, и цены индексного,
 * длинного и короткого токенов передаются в него АРГУМЕНТАМИ — из
 * /prices/tickers, то есть всегда текущие. Прибить блок и оставить цены
 * как есть значило бы оценить вчерашний состав пула сегодняшним рынком:
 * на графике такая точка неотличима от настоящего движения.
 *
 * Токен, для которого исторической цены нет, из карты УБИРАЕТСЯ. Читатель
 * на это рассчитывает: без цены он не отправляет вызов вовсе и помечает
 * рынок как unpriced — «стоимость неизвестна», что и есть правда.
 */
export function historicalGmxApiData(
  live: GmxApiData,
  pricesById: Map<string, PriceInput>,
): GmxApiData {
  const prices = new Map<string, { min: bigint; max: bigint }>();
  for (const [address, decimals] of live.decimals) {
    const symbol = live.symbols.get(address);
    const id = symbol ? coingeckoIdForSymbol(symbol) : null;
    const price = id ? pricesById.get(id) : undefined;
    if (!price) continue;
    const raw = usdToGmxPrice(price.priceUsd, decimals);
    // Спред схлопывается в точку: исторический ряд даёт одну цену, и
    // раздвигать её выдуманными min/max незачем
    prices.set(address, { min: raw, max: raw });
  }
  return { decimals: live.decimals, symbols: live.symbols, markets: live.markets, prices };
}

/** coingecko id токенов рынков, по которым у кошелька есть GM-баланс. */
function gmxHeldPriceIds(live: GmxApiData, status: GmxChainStatus): string[] {
  const marketTokens = [
    ...status.positions.map((p) => p.marketToken.toLowerCase()),
    ...status.unpriced.map((u) => u.marketToken.toLowerCase()),
  ];
  const ids: string[] = [];
  for (const marketToken of marketTokens) {
    const market = live.markets.get(marketToken);
    if (!market) continue;
    for (const token of [market.indexToken, market.longToken, market.shortToken]) {
      const symbol = live.symbols.get(token.toLowerCase());
      const id = symbol ? coingeckoIdForSymbol(symbol) : null;
      if (id) ids.push(id);
    }
  }
  return [...new Set(ids)];
}

/**
 * Собирает сетевую половину портфеля на момент targetSec.
 *
 * Кошельки идут последовательно, протоколы внутри кошелька — тоже: архивные
 * чтения дороже обычных, лимиты провайдера те же, а торопиться скрипту
 * восстановления некуда. Падение одного протокола изолировано ровно так же,
 * как в refreshUserWallets: сеть помечается неотвеченной, и точка выйдет
 * частичной, но выйдет.
 */
export async function buildHistoricalChainSource(
  admin: SupabaseClient,
  userId: string,
  targetSec: number,
  opts: BuildHistoricalSourceOptions = {},
): Promise<BuildHistoricalSourceResult> {
  const { data: walletData, error: walletsError } = await admin
    .from("wallets")
    .select("id, user_id, address, label, last_refreshed_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (walletsError) throw new Error(`wallets: ${walletsError.message}`);
  const wallets = (walletData ?? []) as WalletRow[];
  for (const w of wallets) {
    if (w.user_id !== userId) throw new Error("wallets: строка чужого пользователя");
  }

  const chains = opts.chains ?? (await pinChainsAt(BigInt(Math.floor(targetSec))));
  const checkedAt = new Date(targetSec * 1000).toISOString();

  const collateral: CollateralInput[] = [];
  const stableDebtByKey = new Map<string, StableBorrowReserveInput>();
  const healthRows: DebtHealthRow[] = [];
  const positionRows: PositionRowInput[] = [];
  const free: Omit<FreeBalanceInput, "funds">[] = [];
  const chainStatuses: ChainStatusRow[] = [];
  const debtChains: ChainStatusRow[] = [];
  const freeChains: ChainStatusRow[] = [];

  /**
   * Контур упал целиком (не отдельная сеть) — помечаем все сети.
   * Имя протокола в поле `chain` дало бы в причинах частичности «сеть fluid
   * недоступна»: сетью fluid не является, и читать такое пришлось бы дважды.
   */
  const failAllChains = (
    bucket: ChainStatusRow[],
    contour: string,
    err: unknown,
  ): void => {
    const message = `${contour}: ${err instanceof Error ? err.message : String(err)}`;
    for (const chain of CHAIN_IDS) {
      bucket.push(statusRow(chain, false, message, checkedAt));
    }
  };

  /** Токены, спрятанные глобальным рычагом справочника. */
  const hidden = new Set<string>();
  {
    const { data, error } = await admin
      .from("assets")
      .select("chain, contract_address")
      .eq("is_hidden", true);
    if (error) throw new Error(`assets: ${error.message}`);
    for (const row of data ?? []) {
      hidden.add(
        `${row.chain as string}:${(row.contract_address as string | null) ?? "native"}`,
      );
    }
  }

  // Сеть без архива получает заглушку, а не выпадает из обхода: читатели
  // сами пометят её неотвеченной, и причина дойдёт до причин частичности
  const failureByChain = new Map(chains.failed.map((f) => [f.chain, f.error]));
  const clients = Object.fromEntries(
    CHAIN_IDS.map((chain) => [
      chain,
      chains.clients[chain] ??
        unavailableClient(
          failureByChain.get(chain) ?? `${chain}: архивное чтение недоступно`,
        ),
    ]),
  ) as Record<ChainId, PinnedClient>;
  const gmxClient = clients[GMX_CHAIN] as unknown as GmxRpcClient;
  // GM лежат и OFT-токенами на других сетях: их тоже читаем на блоке той
  // даты, иначе вчерашняя точка взяла бы сегодняшний баланс на Ethereum
  const gmxBridgedClients = readerClients<GmxRpcClient>(clients);

  for (const wallet of wallets) {
    const address = wallet.address as Address;

    // --- Залог Aave ---
    let aave: AaveChainStatus[] = [];
    try {
      aave = await readWalletAaveCollateral(address, { clients: readerClients(clients) });
    } catch (err) {
      failAllChains(chainStatuses, "залог Aave", err);
    }
    for (const status of aave) {
      chainStatuses.push(
        statusRow(status.chain, status.ok, status.error ?? null, checkedAt),
      );
      if (!status.ok) continue;
      for (const c of status.collateral) {
        if (c.raw === 0n) continue;
        collateral.push({
          walletId: wallet.id,
          walletLabel: wallet.label,
          chain: c.chain,
          symbol: c.symbol,
          category: c.category,
          coingeckoId: c.coingeckoId,
          quantity: formatUnits(c.raw, c.decimals),
        });
      }
    }

    // --- Долг и здоровье Aave ---
    let debt: AaveDebtChainStatus[] = [];
    try {
      debt = await readWalletAaveDebt(address, { clients: readerClients(clients) });
    } catch (err) {
      failAllChains(debtChains, "долг Aave", err);
    }
    for (const status of debt) {
      // Аккаунт не прочитан — долг этой сети неизвестен, а не равен нулю
      const ok = status.ok && status.account !== null;
      debtChains.push(
        statusRow(
          status.chain,
          ok,
          status.error ?? status.accountError ?? null,
          checkedAt,
        ),
      );
      if (!status.ok) continue;
      if (status.account) {
        healthRows.push({
          totalDebtUsd: status.account.totalDebtUsd,
          totalCollateralUsd: status.account.totalCollateralUsd,
          healthFactor: status.account.healthFactor,
        });
      }
      for (const d of status.debts) {
        if (d.raw === 0n || !isStableSymbol(d.symbol)) continue;
        const quantity = Number(formatUnits(d.raw, d.decimals));
        if (quantity <= 0) continue;
        const key = `${d.chain}:${d.symbol}`;
        const seen = stableDebtByKey.get(key);
        stableDebtByKey.set(key, {
          chain: d.chain,
          symbol: d.symbol,
          debtUsd: (seen?.debtUsd ?? 0) + quantity * STABLE_PRICE_USD,
          ratePercent: d.borrowRatePercent ?? seen?.ratePercent ?? null,
        });
      }
    }

    // --- Депозит стейблов на Aave: размещение, а не залог (см. aave-supply.ts).
    // Статусы сетей — в общий список: исторический путь различает только
    // залог, долг и свободные средства, остальное — «сеть не ответила»
    try {
      const statuses: AaveSupplyChainStatus[] = await readWalletAaveSupply(
        address,
        { clients: readerClients(clients) },
      );
      for (const status of statuses) {
        chainStatuses.push(
          statusRow(status.chain, status.ok, status.error ?? null, checkedAt),
        );
        if (!status.ok) continue;
        for (const p of status.positions) {
          const aToken = p.aToken.toLowerCase();
          positionRows.push({
            id: `hist:${AAVE_SUPPLY_SOURCE}:${p.chain}:${aToken}`,
            protocol: AAVE_SUPPLY_SOURCE,
            chain: p.chain,
            externalId: aToken,
            quantity: formatUnits(p.raw, p.decimals),
            // null — оценка соберется по ИСТОРИЧЕСКОЙ цене в buildPositions
            valueUsd: null,
            payload: {
              kind: "aave_supply",
              symbol: p.symbol,
              coingeckoId: p.coingeckoId,
              aToken,
              underlying: p.underlying.toLowerCase(),
              decimals: p.decimals,
              raw: p.raw.toString(),
              supplyRatePercent: p.supplyRatePercent,
              usedAsCollateral: p.usedAsCollateral,
            },
            updatedAt: checkedAt,
            walletId: wallet.id,
            walletLabel: wallet.label,
          });
        }
      }
    } catch (err) {
      console.warn(`[historical] депозиты Aave ${address}:`, err);
      failAllChains(chainStatuses, "депозиты Aave", err);
    }

    // --- Размещенные позиции. Каждый протокол в своем try/catch, как
    // в refreshUserWallets: недоступность одного не лишает точку остальных
    try {
      const statuses: FluidChainStatus[] = await readWalletFluid(address, {
        clients: readerClients(clients),
      });
      for (const status of statuses) {
        chainStatuses.push(
          statusRow(status.chain, status.ok, status.error ?? null, checkedAt),
        );
        if (!status.ok) continue;
        for (const p of status.positions) {
          positionRows.push({
            id: `hist:${FLUID_SOURCE}:${p.chain}:${p.fToken.toLowerCase()}`,
            protocol: FLUID_SOURCE,
            chain: p.chain,
            externalId: p.fToken.toLowerCase(),
            quantity: formatUnits(p.raw, p.decimals),
            // null — оценка соберется по ИСТОРИЧЕСКОЙ цене актива в buildPositions
            valueUsd: null,
            payload: {
              kind: "fluid_supply",
              symbol: p.symbol,
              fTokenSymbol: p.fTokenSymbol,
              coingeckoId: p.coingeckoId,
              fToken: p.fToken.toLowerCase(),
              underlying: p.underlying.toLowerCase(),
              decimals: p.decimals,
              raw: p.raw.toString(),
              supplyRatePercent: p.supplyRatePercent,
              rewardsRatePercent: p.rewardsRatePercent,
            },
            updatedAt: checkedAt,
            walletId: wallet.id,
            walletLabel: wallet.label,
          });
        }
      }
    } catch (err) {
      console.warn(`[historical] Fluid ${address}:`, err);
      failAllChains(chainStatuses, "Fluid", err);
    }

    // --- GM-пулы: два прохода, см. комментарий у historicalGmxApiData ---
    {
      try {
        const live = opts.gmxApiData ?? (await getGmxApiData());
        const probe: GmxChainStatus = await readWalletGmx(address, {
          client: gmxClient,
          bridgedClients: gmxBridgedClients,
          apiData: live,
        });
        const ids = gmxHeldPriceIds(live, probe);
        const status =
          ids.length === 0
            ? probe
            : await readWalletGmx(address, {
                client: gmxClient,
                bridgedClients: gmxBridgedClients,
                apiData: historicalGmxApiData(
                  live,
                  await getHistoricalCoinPrices(ids, targetSec),
                ),
              });

        chainStatuses.push(
          statusRow(status.chain, status.ok, status.error ?? null, checkedAt),
        );
        for (const p of status.positions) {
          positionRows.push({
            id: `hist:${GMX_SOURCE}:${status.chain}:${p.marketToken.toLowerCase()}`,
            protocol: GMX_SOURCE,
            chain: status.chain,
            externalId: p.marketToken.toLowerCase(),
            quantity: p.quantity.toString(),
            valueUsd: p.valueUsd,
            payload: {
              kind: "gmx_gm",
              marketName: p.marketName,
              marketToken: p.marketToken.toLowerCase(),
              gmPriceUsd: p.gmPriceUsd,
              raw: p.raw.toString(),
              multichainRaw: p.multichainRaw.toString(),
              bridged: p.bridged.map((h) => ({ chain: h.chain, raw: h.raw.toString() })),
              components: p.components,
            },
            updatedAt: checkedAt,
            walletId: wallet.id,
            walletLabel: wallet.label,
          });
        }
      } catch (err) {
        console.warn(`[historical] GM-пулы ${address}:`, err);
        chainStatuses.push(
          statusRow(
            GMX_CHAIN,
            false,
            `GM-пулы: ${err instanceof Error ? err.message : String(err)}`,
            checkedAt,
          ),
        );
      }
    }

    // --- LP Uniswap v3 ---
    try {
      const statuses: UniV3ChainStatus[] = await readWalletUniswapV3(address, {
        clients: readerClients(clients),
      });
      for (const status of statuses) {
        chainStatuses.push(
          statusRow(status.chain, status.ok, status.error ?? null, checkedAt),
        );
        if (!status.ok) continue;
        for (const p of status.positions) {
          positionRows.push({
            id: `hist:${UNIV3_SOURCE}:${p.chain}:${p.tokenId}`,
            protocol: UNIV3_SOURCE,
            chain: p.chain,
            externalId: p.tokenId,
            quantity: p.liquidity,
            valueUsd: null,
            payload: {
              kind: "univ3_lp",
              poolAddress: p.poolAddress,
              fee: p.fee,
              tickLower: p.tickLower,
              tickUpper: p.tickUpper,
              tick: p.tick,
              inRange: p.inRange,
              liquidity: p.liquidity,
              token0: p.token0,
              token1: p.token1,
              // «Вне диапазона с» — след наблюдения, а не состояние контракта:
              // восстановить его задним числом нечем, и выдумывать нельзя
              outOfRangeSince: null,
              fees24h: p.fees24h,
            },
            updatedAt: checkedAt,
            walletId: wallet.id,
            walletLabel: wallet.label,
          });
        }
      }
    } catch (err) {
      console.warn(`[historical] LP-позиции ${address}:`, err);
      failAllChains(chainStatuses, "LP Uniswap", err);
    }

    // --- Pendle ---
    try {
      const statuses: PendleChainStatus[] = await readWalletPendle(address, {
        clients: readerClients(clients),
      });
      for (const status of statuses) {
        chainStatuses.push(
          statusRow(status.chain, status.ok, status.error ?? null, checkedAt),
        );
        if (!status.ok) continue;
        for (const p of status.positions) {
          // Та же строка, что пишет живой путь: расхождение payload'а
          // немедленно разошлось бы с buildPositions
          const row = pendleRowOf(wallet.id, p, checkedAt);
          positionRows.push({
            id: `hist:${PENDLE_SOURCE}:${row.chain}:${row.external_id}`,
            protocol: row.protocol,
            chain: row.chain,
            externalId: row.external_id,
            quantity: row.quantity,
            valueUsd: row.value_usd,
            payload: row.payload,
            updatedAt: checkedAt,
            walletId: wallet.id,
            walletLabel: wallet.label,
          });
        }
      }
    } catch (err) {
      console.warn(`[historical] Pendle ${address}:`, err);
      failAllChains(chainStatuses, "Pendle", err);
    }

    // --- Свободные средства ---
    try {
      const statuses: ChainReadStatus[] = await readWalletBalances(address, {
        clients: readerClients(clients),
      });
      for (const status of statuses) {
        freeChains.push(
          statusRow(status.chain, status.ok, status.error ?? null, checkedAt),
        );
        if (!status.ok) continue;
        for (const b of status.balances) {
          if (b.raw === 0n) continue;
          const token = b.contractAddress ?? "native";
          if (hidden.has(`${b.chain}:${token}`)) continue;
          free.push({
            key: `${wallet.id}:${b.chain}:${token}`,
            walletId: wallet.id,
            walletLabel: wallet.label,
            chain: b.chain,
            token,
            symbol: b.symbol,
            category: symbolCategory(b.symbol),
            coingeckoId: b.coingeckoId,
            quantity: rawToQuantity(b.raw.toString(), b.decimals),
            updatedAt: checkedAt,
          });
        }
      }
    } catch (err) {
      console.warn(`[historical] балансы ${address}:`, err);
      failAllChains(freeChains, "свободные балансы", err);
    }
  }

  const report: HistoricalReadReport = {
    blocks: chains.blocks,
    failedChains: chains.failed,
    missingPrices: [],
    offPrices: [],
  };

  const source: ChainSource = {
    collateral,
    stableDebt: [...stableDebtByKey.values()],
    healthRows,
    positionRows,
    free,
    chains: chainStatuses,
    debtChains,
    freeChains,
    // «Самый старый залог» — про свежесть кэша; у измерения на блоке
    // свежесть одна на всю точку, и это время самого блока
    oldestCollateralAt: checkedAt,
    async loadPrices(ids: string[]): Promise<Map<string, PriceInput>> {
      const wanted = [
        ...new Set([
          CATEGORY_COINGECKO_IDS.btc,
          CATEGORY_COINGECKO_IDS.eth,
          ...ids,
        ]),
      ];
      const prices = await getHistoricalCoinPrices(wanted, targetSec);
      for (const id of wanted) {
        const price = prices.get(id);
        if (!price) report.missingPrices.push(id);
        else if (price.stale) {
          report.offPrices.push({ id, offsetSec: price.offsetSec });
        }
      }
      return prices;
    },
  };

  return { source, report };
}
