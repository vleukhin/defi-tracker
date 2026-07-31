/**
 * Единая таблица «символ токена → coingecko id».
 *
 * До Фазы 5 такая таблица жила только в chains/aave-debt.ts и была привязана
 * к символам address book. Читателей стало четыре (Aave, Fluid, GMX, Uniswap),
 * и каждый видит символ из своего источника — общий словарь дешевле, чем
 * четыре расходящиеся копии.
 *
 * Отсутствие id — НЕ ошибка: количество показывается без оценки в долларах.
 * Придумывать цену «по похожему тикеру» нельзя, поэтому маппинг только явный.
 */

/** Символы, по которым цену берем как за $1 не глядя — таких нет: депеги реальны. */
const SYMBOL_TO_ID: Record<string, string> = {
  // --- мажоры и обертки ---
  BTC: "bitcoin",
  WBTC: "wrapped-bitcoin",
  "WBTC.b": "wrapped-bitcoin",
  cbBTC: "coinbase-wrapped-btc",
  tBTC: "tbtc",
  LBTC: "lombard-staked-btc",
  ETH: "ethereum",
  WETH: "weth",
  wstETH: "wrapped-steth",
  stETH: "staked-ether",
  weETH: "wrapped-eeth",
  eETH: "ether-fi-staked-eth",
  rETH: "rocket-pool-eth",
  cbETH: "coinbase-wrapped-staked-eth",
  ezETH: "renzo-restaked-eth",
  rsETH: "kelp-dao-restaked-eth",
  osETH: "stakewise-v3-oseth",
  ETHx: "stader-ethx",

  // --- стейблы ---
  USDC: "usd-coin",
  "USDC.e": "bridged-usd-coin",
  USDbC: "bridged-usd-coin-base",
  USDT: "tether",
  USDT0: "tether",
  "USD₮0": "tether",
  DAI: "dai",
  sDAI: "savings-dai",
  USDS: "usds",
  sUSDS: "susds",
  GHO: "gho",
  LUSD: "liquity-usd",
  FRAX: "frax",
  sUSD: "nusd",
  crvUSD: "crvusd",
  PYUSD: "paypal-usd",
  USDe: "ethena-usde",
  sUSDe: "ethena-staked-usde",
  USDtb: "ethena-usdtb",
  RLUSD: "ripple-usd",
  AUSD: "agora-dollar",
  EURC: "euro-coin",
  EURS: "stasis-eurs",
  MAI: "mimatic",

  // --- прочие, которые реально встречаются в залоге, долге и пулах ---
  LINK: "chainlink",
  AAVE: "aave",
  ARB: "arbitrum",
  OP: "optimism",
  CRV: "curve-dao-token",
  UNI: "uniswap",
  MKR: "maker",
  LDO: "lido-dao",
  GMX: "gmx",
  SOL: "solana",
  WPOL: "polygon-ecosystem-token",
  WBNB: "binancecoin",
};

/**
 * id по символу; null — цены осознанно нет.
 * Регистр значим: wstETH и WSTETH — один токен, поэтому сверяем и как есть,
 * и по верхнему регистру, но выдуманных совпадений не допускаем.
 */
export function coingeckoIdForSymbol(symbol: string): string | null {
  const direct = SYMBOL_TO_ID[symbol];
  if (direct) return direct;
  const upper = symbol.toUpperCase();
  for (const [key, id] of Object.entries(SYMBOL_TO_ID)) {
    if (key.toUpperCase() === upper) return id;
  }
  return null;
}

/**
 * Стейблкоин ли это — нужно для неттинга Fluid против ручных записей
 * категории «Стейблы» (иначе собственные деньги посчитались бы дважды).
 * Список именно долларовых: EURC/EURS долларовыми записями не покрываются.
 */
const STABLE_IDS = new Set([
  "usd-coin",
  "bridged-usd-coin",
  "bridged-usd-coin-base",
  "tether",
  "dai",
  "savings-dai",
  "usds",
  "susds",
  "gho",
  "liquity-usd",
  "frax",
  "nusd",
  "crvusd",
  "paypal-usd",
  "ethena-usde",
  "ethena-staked-usde",
  "ethena-usdtb",
  "ripple-usd",
  "agora-dollar",
  "mimatic",
]);

export function isStableCoingeckoId(id: string | null): boolean {
  return id !== null && STABLE_IDS.has(id);
}
