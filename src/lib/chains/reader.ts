import "server-only";
import { erc20Abi, type Address } from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAIN_IDS, getChainClients, type ChainId } from "./config";
import { TOKEN_ALLOWLIST } from "./allowlist";
import { logApiCall } from "@/lib/metrics";
import { CATEGORY_COINGECKO_IDS } from "@/lib/prices/coins";
import { ERC20_SOURCE } from "@/lib/positions/sources";

/**
 * Чтение свободных средств кошелька (ТЗ Часть 4 §3.2):
 * нативный баланс + balanceOf по allowlist — один multicall на сеть,
 * allowFailure: true (упавший вызов = «неизвестно», НЕ ноль),
 * 4 сети параллельно, отказ одной сети изолирован (ok: false).
 * Все сырые значения — bigint + decimals из справочника.
 *
 * «Свободные» — то, что лежит на адресе и не участвует ни в залоге, ни
 * в позициях. Пересечений с ними нет по построению: залог живет в aToken'ах,
 * долг в vToken'ах, депозит Fluid в fToken'ах, GM-пулы перечисляются по
 * списку рынков GMX, а LP Uniswap — это ERC-721, которого balanceOf по
 * ERC-20 не видит. В allowlist лежат UNDERLYING-адреса, и сторож в
 * allowlist.test.ts следит, чтобы так и осталось.
 *
 * Модуль писался в Фазе 1 и до Фазы 7 никем не вызывался: количества брались
 * из залога и ручных записей.
 */

export interface TokenBalanceReading {
  chain: ChainId;
  /** null = нативная монета (ETH). */
  contractAddress: `0x${string}` | null;
  symbol: string;
  decimals: number;
  raw: bigint;
  /**
   * CoinGecko id — чтобы вызывающий собрал список цен, не импортируя
   * allowlist во второй раз. null = у токена нет листинга в справочнике.
   */
  coingeckoId: string | null;
}

export interface ChainReadStatus {
  chain: ChainId;
  ok: boolean;
  /** Причина полного отказа сети (RPC down и т.п.). */
  error?: string;
  balances: TokenBalanceReading[];
  /** Упавшие внутри multicall вызовы: значение неизвестно, кэш не трогаем. */
  failedTokens: { contractAddress: `0x${string}`; symbol: string; reason: string }[];
}

/** Узкий интерфейс RPC-клиента — для инъекции моков в тестах. */
export interface BalanceRpcClient {
  getBalance(args: { address: Address }): Promise<bigint>;
  multicall(args: {
    contracts: readonly {
      address: Address;
      abi: typeof erc20Abi;
      functionName: "balanceOf";
      args: readonly [Address];
    }[];
    allowFailure: true;
  }): Promise<
    readonly (
      | { status: "success"; result: unknown }
      | { status: "failure"; error: Error; result?: undefined }
    )[]
  >;
}

export interface ReadOptions {
  clients?: Record<ChainId, BalanceRpcClient>;
  logCall?: typeof logApiCall;
}

/** Один multicall + нативный баланс на одной сети. */
export async function readChainBalances(
  client: BalanceRpcClient,
  chain: ChainId,
  wallet: Address,
  logCall: typeof logApiCall = logApiCall,
): Promise<ChainReadStatus> {
  const tokens = TOKEN_ALLOWLIST[chain];
  try {
    const [native, results] = await Promise.all([
      client.getBalance({ address: wallet }),
      client.multicall({
        contracts: tokens.map((t) => ({
          address: t.address,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [wallet] as const,
        })),
        allowFailure: true,
      }),
    ]);

    // Счетчик RPC-квоты: getBalance + multicall = 2 запроса
    // (консервативно относим к квоте Alchemy — первого транспорта в цепочке).
    void logCall("alchemy", `read:${chain}`, { units: 2 });

    const balances: TokenBalanceReading[] = [
      {
        chain,
        contractAddress: null,
        symbol: "ETH",
        decimals: 18,
        raw: native,
        // Все четыре сети — L1 и его роллапы, нативная монета везде ETH
        coingeckoId: CATEGORY_COINGECKO_IDS.eth,
      },
    ];
    const failedTokens: ChainReadStatus["failedTokens"] = [];

    results.forEach((res, i) => {
      const token = tokens[i];
      if (res.status === "success" && typeof res.result === "bigint") {
        balances.push({
          chain,
          contractAddress: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
          raw: res.result,
          coingeckoId: token.coingeckoId,
        });
      } else {
        const reason =
          res.status === "failure"
            ? (res.error?.message ?? "call reverted")
            : "unexpected result type";
        // «Неизвестно», не ноль: логируем и пропускаем (ТЗ §3.1)
        console.warn(
          `[reader] ${chain}: balanceOf(${token.symbol} ${token.address}) не прочитан: ${reason}`,
        );
        failedTokens.push({
          contractAddress: token.address,
          symbol: token.symbol,
          reason,
        });
      }
    });

    return { chain, ok: true, balances, failedTokens };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logCall("alchemy", `read:${chain}`, { units: 2, ok: false });
    console.warn(`[reader] ${chain}: сеть недоступна: ${message}`);
    // Отказ сети деградирует только эту сеть (ТЗ S1.3)
    return { chain, ok: false, error: message, balances: [], failedTokens: [] };
  }
}

/** Балансы кошелька на всех 4 сетях параллельно; отказ сети изолирован. */
export async function readWalletBalances(
  wallet: Address,
  opts: ReadOptions = {},
): Promise<ChainReadStatus[]> {
  const clients =
    opts.clients ??
    (getChainClients() as unknown as Record<ChainId, BalanceRpcClient>);
  const logCall = opts.logCall ?? logApiCall;
  return Promise.all(
    CHAIN_IDS.map((chain) =>
      readChainBalances(clients[chain], chain, wallet, logCall),
    ),
  );
}

interface AssetKeyRow {
  id: string;
  chain: string;
  contract_address: string | null;
  kind: string;
}

const assetKey = (chain: string, contract: string | null) =>
  `${chain}:${contract ?? "native"}`;

/**
 * Запись результатов чтения в balances_cache (service-role клиент).
 * Ненулевые балансы — upsert; нулевые — delete (кэш не пухнет);
 * упавшие вызовы и упавшие сети кэш НЕ трогают (последнее известное состояние).
 */
export async function persistBalances(
  admin: SupabaseClient,
  walletId: string,
  statuses: ChainReadStatus[],
): Promise<void> {
  const { data: assets, error: assetsError } = await admin
    .from("assets")
    .select("id, chain, contract_address, kind")
    .in("kind", ["native", "erc20"]);
  if (assetsError) {
    throw new Error(`не удалось загрузить справочник assets: ${assetsError.message}`);
  }

  const byKey = new Map<string, AssetKeyRow>(
    (assets ?? []).map((a: AssetKeyRow) => [
      assetKey(a.chain, a.contract_address),
      a,
    ]),
  );

  const nowIso = new Date().toISOString();
  const upserts: {
    wallet_id: string;
    asset_id: string;
    raw_amount: string;
    updated_at: string;
  }[] = [];
  const zeroAssetIds: string[] = [];

  for (const status of statuses) {
    if (!status.ok) continue; // сеть упала — оставляем последние известные данные
    for (const b of status.balances) {
      const asset = byKey.get(assetKey(b.chain, b.contractAddress));
      if (!asset) continue; // актива нет в справочнике (сид не накачен) — пропуск
      if (b.raw === 0n) {
        zeroAssetIds.push(asset.id);
      } else {
        upserts.push({
          wallet_id: walletId,
          asset_id: asset.id,
          // bigint -> строка; numeric(78,0) принимает десятичную строку
          raw_amount: b.raw.toString(),
          updated_at: nowIso,
        });
      }
    }
  }

  if (upserts.length > 0) {
    const { error } = await admin
      .from("balances_cache")
      .upsert(upserts, { onConflict: "wallet_id,asset_id" });
    if (error) throw new Error(`balances_cache upsert: ${error.message}`);
  }
  if (zeroAssetIds.length > 0) {
    const { error } = await admin
      .from("balances_cache")
      .delete()
      .eq("wallet_id", walletId)
      .in("asset_id", zeroAssetIds);
    if (error) throw new Error(`balances_cache cleanup: ${error.message}`);
  }
}

/**
 * Статус чтения балансов по сетям — чтобы GET /api/portfolio (только кэш,
 * без RPC) честно показывал деградацию: свободные средства на упавшей сети
 * не «стали нулем», а неизвестны, и кэш по ней остался прежним.
 */
export async function persistBalanceStatus(
  admin: SupabaseClient,
  walletId: string,
  statuses: ChainReadStatus[],
): Promise<void> {
  const checkedAt = new Date().toISOString();
  const { error } = await admin.from("chain_read_status").upsert(
    statuses.map((s) => ({
      wallet_id: walletId,
      source: ERC20_SOURCE,
      chain: s.chain,
      ok: s.ok,
      error: s.error ?? null,
      checked_at: checkedAt,
    })),
    { onConflict: "wallet_id,source,chain" },
  );
  if (error) throw new Error(`chain_read_status upsert: ${error.message}`);
}
