import type { ChainId } from "./config";

/**
 * Курируемый allowlist токенов (ТЗ Часть 4 §3.2, §7):
 * основной источник читаемых ERC-20; спам-токены сюда не попадают.
 *
 * ВНЕ пути портфеля: модель портфеля (btc/eth/stable) считается по залогу
 * Aave v3 (src/lib/chains/aave.ts) и ручным записям. Этот справочник нужен
 * generic-ридеру балансов (reader.ts) — задел под Фазу 5 (GMX/LP).
 *
 * Адреса хранятся в lowercase — так же они лежат в БД (assets.contract_address)
 * и так же ключуются ответы CoinGecko. EIP-55 нужен только для адресов
 * кошельков пользователя, не для справочника контрактов.
 *
 * ВАЖНО: USDC и USDC.e (bridged) — разные активы, никогда не объединяются.
 */

export interface AllowlistToken {
  /** Адрес контракта, lowercase hex. */
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  /** CoinGecko id (для нативных цен и флага «есть листинг»). */
  coingeckoId: string | null;
}

const T = (
  address: string,
  symbol: string,
  decimals: number,
  coingeckoId: string | null,
): AllowlistToken => ({
  address: address.toLowerCase() as `0x${string}`,
  symbol,
  decimals,
  coingeckoId,
});

export const TOKEN_ALLOWLIST: Record<ChainId, readonly AllowlistToken[]> = {
  ethereum: [
    T("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", "WETH", 18, "weth"),
    T("0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", "WBTC", 8, "wrapped-bitcoin"),
    T("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "USDC", 6, "usd-coin"),
    T("0xdac17f958d2ee523a2206206994597c13d831ec7", "USDT", 6, "tether"),
    T("0x6b175474e89094c44da98b954eedeac495271d0f", "DAI", 18, "dai"),
    T("0x514910771af9ca656af840dff83e8264ecf986ca", "LINK", 18, "chainlink"),
    T("0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", "UNI", 18, "uniswap"),
    T("0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", "AAVE", 18, "aave"),
    T("0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", "wstETH", 18, "wrapped-steth"),
    T("0xae7ab96520de3a18e5e111b5eaab095312d7fe84", "stETH", 18, "staked-ether"),
    T("0xae78736cd615f374d3085123a210448e74fc6393", "rETH", 18, "rocket-pool-eth"),
    T("0xbe9895146f7af43049ca1c1ae358b0541ea49704", "cbETH", 18, "coinbase-wrapped-staked-eth"),
    T("0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee", "weETH", 18, "wrapped-eeth"),
    T("0x4c9edd5852cd905f086c759e8383e09bff1e68b3", "USDe", 18, "ethena-usde"),
    T("0x9d39a5de30e57443bff2a8307a4256c8797a3497", "sUSDe", 18, "ethena-staked-usde"),
    T("0x18084fba666a33d37592fa2633fd49a74dd93a88", "tBTC", 18, "tbtc"),
    T("0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2", "MKR", 18, "maker"),
    T("0x5a98fcbea516cf06857215779fd812ca3bef1b32", "LDO", 18, "lido-dao"),
    T("0xd533a949740bb3306d119cc777fa900ba034cd52", "CRV", 18, "curve-dao-token"),
    T("0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f", "SNX", 18, "havven"),
    T("0xc00e94cb662c3520282e6f5717214004a7f26888", "COMP", 18, "compound-governance-token"),
    T("0xc18360217d8f7ab5e7c516566761ea12ce7f9d72", "ENS", 18, "ethereum-name-service"),
    T("0x6982508145454ce325ddbe47a25d4ec3d2311933", "PEPE", 18, "pepe"),
    T("0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", "SHIB", 18, "shiba-inu"),
    T("0x853d955acef822db058eb8505911ed77f175b99e", "FRAX", 18, "frax"),
    T("0xc944e90c64b2c07662a292be6244bdf05cda44a7", "GRT", 18, "the-graph"),
    T("0x111111111117dc0aa78b770fa6a738034120c302", "1INCH", 18, "1inch"),
    T("0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3", "ONDO", 18, "ondo-finance"),
    T("0xd33526068d116ce69f19a9ee46f0bd304f21a51f", "RPL", 18, "rocket-pool"),
    T("0x808507121b80c02388fad14726482e061b8da827", "PENDLE", 18, "pendle"),
  ],
  arbitrum: [
    T("0x82af49447d8a07e3bd95bd0d56f35241523fbab1", "WETH", 18, "weth"),
    T("0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f", "WBTC", 8, "wrapped-bitcoin"),
    // USDC (native Circle) и USDC.e (bridged) — разные активы!
    T("0xaf88d065e77c8cc2239327c5edb3a432268e5831", "USDC", 6, "usd-coin"),
    T("0xff970a61a04b1ca14834a43f5de4533ebddb5cc8", "USDC.e", 6, "usd-coin-ethereum-bridged"),
    T("0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", "USDT", 6, "tether"),
    T("0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", "DAI", 18, "dai"),
    T("0x912ce59144191c1204e64559fe8253a0e49e6548", "ARB", 18, "arbitrum"),
    T("0xf97f4df75117a78c1a5a0dbb814af92458539fb4", "LINK", 18, "chainlink"),
    T("0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0", "UNI", 18, "uniswap"),
    T("0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a", "GMX", 18, "gmx"),
    T("0x5979d7b546e38e414f7e9822514be443a4800529", "wstETH", 18, "wrapped-steth"),
    T("0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8", "rETH", 18, "rocket-pool-eth"),
    T("0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34", "USDe", 18, "ethena-usde"),
    T("0x35751007a407ca6feffe80b3cb397736d2cf4dbe", "weETH", 18, "wrapped-eeth"),
    T("0x0c880f6761f1af8d9aa9c466984b80dab9a8c9e8", "PENDLE", 18, "pendle"),
    T("0x11cdb42b0eb46d95f990bedd4695a6e3fa034978", "CRV", 18, "curve-dao-token"),
    T("0xba5ddd1f9d7f570dc94a51479a000e3bce967196", "AAVE", 18, "aave"),
    T("0x13ad51ed4f1b7e9dc168d8a00cb3f4ddd85efa60", "LDO", 18, "lido-dao"),
    T("0x6c84a8f1c29108f47a79964b5fe888d4f4d0de40", "tBTC", 18, "tbtc"),
    T("0x17fc002b466eec40dae837fc4be5c67993ddbd6f", "FRAX", 18, "frax"),
    T("0x539bde0d7dbd336b79148aa742883198bbf60342", "MAGIC", 18, "magic"),
    T("0x3082cc23568ea640225c2467653db90e9250aaa0", "RDNT", 18, "radiant-capital"),
  ],
  base: [
    T("0x4200000000000000000000000000000000000006", "WETH", 18, "weth"),
    // USDC (native Circle) и USDbC (bridged) — разные активы!
    T("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "USDC", 6, "usd-coin"),
    T("0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", "USDbC", 6, "bridged-usd-coin-base"),
    T("0x50c5725949a6f0c72e6c4a641f24049a917db0cb", "DAI", 18, "dai"),
    T("0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", "USDT", 6, "tether"),
    T("0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", "cbETH", 18, "coinbase-wrapped-staked-eth"),
    T("0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452", "wstETH", 18, "wrapped-steth"),
    T("0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", "cbBTC", 8, "coinbase-wrapped-btc"),
    T("0x940181a94a35a4569e4529a3cdfb74e38fd98631", "AERO", 18, "aerodrome-finance"),
    T("0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c", "rETH", 18, "rocket-pool-eth"),
    T("0x04c0599ae5a44757c0af6f9ec3b93da8976c150a", "weETH", 18, "wrapped-eeth"),
    T("0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34", "USDe", 18, "ethena-usde"),
    T("0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", "EURC", 6, "euro-coin"),
    T("0x4ed4e862860bed51a9570b96d89af5e1b0efefed", "DEGEN", 18, "degen-base"),
    T("0x532f27101965dd16442e59d40670faf5ebb142e4", "BRETT", 18, "based-brett"),
    T("0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b", "VIRTUAL", 18, "virtual-protocol"),
    T("0xbaa5cc21fd487b8fcc2f632f3f4e8d37262a0842", "MORPHO", 18, "morpho"),
    T("0xecac9c5f704e954931349da37f60e39f515c11c1", "LBTC", 8, "lombard-staked-btc"),
  ],
  optimism: [
    T("0x4200000000000000000000000000000000000006", "WETH", 18, "weth"),
    T("0x4200000000000000000000000000000000000042", "OP", 18, "optimism"),
    // USDC (native Circle) и USDC.e (bridged) — разные активы!
    T("0x0b2c639c533813f4aa9d7837caf62653d097ff85", "USDC", 6, "usd-coin"),
    T("0x7f5c764cbc14f9669b88837ca1490cca17c31607", "USDC.e", 6, "usd-coin-ethereum-bridged"),
    T("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", "USDT", 6, "tether"),
    T("0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", "DAI", 18, "dai"),
    T("0x68f180fcce6836688e9084f035309e29bf0a2095", "WBTC", 8, "wrapped-bitcoin"),
    T("0x350a791bfc2c21f9ed5d10980dae2ae26b0b8688", "LINK", 18, "chainlink"),
    T("0x1f32b1c2345538c0c6f582fcb022739c4a194ebb", "wstETH", 18, "wrapped-steth"),
    T("0x9bcef72be871e61ed4fbbc7630889bee758eb81d", "rETH", 18, "rocket-pool-eth"),
    T("0x8700daec35af8ff88c16bdf0418774cb3d7599b4", "SNX", 18, "havven"),
    T("0x9560e827af36c94d2ac33a39bce1fe78631088db", "VELO", 18, "velodrome-finance"),
    T("0x76fb31fb4af56892a25e32cfc43de717950c9278", "AAVE", 18, "aave"),
    T("0x2e3d870790dc77a83dd1d18184acc7439a53f475", "FRAX", 18, "frax"),
    T("0x6c84a8f1c29108f47a79964b5fe888d4f4d0de40", "tBTC", 18, "tbtc"),
    T("0xdc6ff44d5d932cbd77b52e5612ba0529dc6226f1", "WLD", 18, "worldcoin-wld"),
    T("0x9e1028f5f1d5ede59748ffcee5532509976840e0", "PERP", 18, "perpetual-protocol"),
  ],
};

/** Нативная монета (ETH) как «псевдотокен» для сидов и агрегации. */
export const NATIVE_ASSET = {
  symbol: "ETH",
  decimals: 18,
  coingeckoId: "ethereum",
};
