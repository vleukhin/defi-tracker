import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { mainnet, arbitrum, base, optimism, type Chain } from "viem/chains";

/**
 * Конфигурация 4 поддерживаемых сетей (ТЗ Часть 4 §3.1):
 * один viem-клиент на сеть, fallback([alchemy, drpc, publicnode]),
 * multicall-батчинг, Multicall3 по единому адресу.
 *
 * Модуль не тянет секретов на клиент сам по себе, но использовать его
 * следует только из серверного кода (reader импортирует "server-only").
 */

export const CHAIN_IDS = ["ethereum", "arbitrum", "base", "optimism"] as const;
export type ChainId = (typeof CHAIN_IDS)[number];

/** Единый адрес Multicall3 на всех 4 сетях (ТЗ §3.1). */
export const MULTICALL3_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/** Платформы CoinGecko для /simple/token_price/{platform} (ТЗ §4). */
export const COINGECKO_PLATFORMS: Record<ChainId, string> = {
  ethereum: "ethereum",
  arbitrum: "arbitrum-one",
  base: "base",
  optimism: "optimistic-ethereum",
};

/** Нативная монета всех 4 сетей — ETH; coingecko id один. */
export const NATIVE_COINGECKO_ID = "ethereum";

interface ChainRpcConfig {
  viemChain: Chain;
  alchemyHost: string;
  fallbackUrls: [drpc: string, publicnode: string];
}

const RPC_CONFIG: Record<ChainId, ChainRpcConfig> = {
  ethereum: {
    viemChain: mainnet,
    alchemyHost: "eth-mainnet.g.alchemy.com",
    fallbackUrls: ["https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"],
  },
  arbitrum: {
    viemChain: arbitrum,
    alchemyHost: "arb-mainnet.g.alchemy.com",
    fallbackUrls: [
      "https://arbitrum.drpc.org",
      "https://arbitrum-one-rpc.publicnode.com",
    ],
  },
  base: {
    viemChain: base,
    alchemyHost: "base-mainnet.g.alchemy.com",
    fallbackUrls: ["https://base.drpc.org", "https://base-rpc.publicnode.com"],
  },
  optimism: {
    viemChain: optimism,
    alchemyHost: "opt-mainnet.g.alchemy.com",
    fallbackUrls: [
      "https://optimism.drpc.org",
      "https://optimism-rpc.publicnode.com",
    ],
  },
};

/**
 * URL Alchemy для сети; null — ключа нет.
 *
 * Нужен не только транспорту viem: у Alchemy есть методы вне JSON-RPC
 * (`alchemy_getAssetTransfers`, Фаза 8), которые ходят обычным fetch'ем мимо
 * клиента, и адрес им нужен тот же самый.
 *
 * Ключ читается ВНУТРИ функции, а не на уровне модуля. Разница видна в тестах:
 * значение уровня модуля замерзает на импорте, то есть до того, как тест
 * выставил переменную окружения, и проверка «без ключа падаем на запасной
 * путь» начала бы зависеть от порядка импортов.
 *
 * Сам `RPC_CONFIG` наружу не выдаётся: список fallback-узлов — деталь
 * транспорта, и читать его помимо клиента незачем.
 */
export function alchemyRpcUrl(chainId: ChainId): string | null {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return null;
  return `https://${RPC_CONFIG[chainId].alchemyHost}/v2/${key}`;
}

function buildClient(chainId: ChainId): PublicClient {
  const { viemChain, fallbackUrls } = RPC_CONFIG[chainId];
  const alchemyUrl = alchemyRpcUrl(chainId);

  const transports = [
    // Ключевой провайдер первым в цепочке (ТЗ §7); без ключа — сразу fallback.
    ...(alchemyUrl ? [http(alchemyUrl)] : []),
    ...fallbackUrls.map((url) => http(url)),
  ];

  return createPublicClient({
    chain: {
      ...viemChain,
      contracts: {
        ...viemChain.contracts,
        multicall3: { address: MULTICALL3_ADDRESS },
      },
    },
    transport: fallback(transports),
    batch: { multicall: { batchSize: 1024 } },
  });
}

let clientCache: Record<ChainId, PublicClient> | null = null;

/** Клиенты создаются лениво и кэшируются на процесс (serverless-инстанс). */
export function getChainClients(): Record<ChainId, PublicClient> {
  if (!clientCache) {
    clientCache = {
      ethereum: buildClient("ethereum"),
      arbitrum: buildClient("arbitrum"),
      base: buildClient("base"),
      optimism: buildClient("optimism"),
    };
  }
  return clientCache;
}
