/**
 * Плитки протоколов: фирменный цвет, аббревиатура и подпись. Сам знак
 * живёт в [`protocol-icons.tsx`](./protocol-icons.tsx) — аббревиатура
 * осталась запасным вариантом для источника, марки которого у нас нет.
 *
 * Цвета берутся из брендов протоколов и НЕ участвуют в ролях дизайн-кода:
 * это метка источника, а не данные и не семантика.
 */
export interface ProtocolBrand {
  abbr: string;
  color: string;
  label: string;
}

export const PROTOCOL_BRANDS: Record<string, ProtocolBrand> = {
  uniswap: { abbr: "UNI", color: "var(--protocol-uniswap)", label: "Uniswap v3" },
  aave: { abbr: "AAV", color: "var(--protocol-aave)", label: "Aave v3" },
  fluid: { abbr: "FLD", color: "var(--protocol-fluid)", label: "Fluid" },
  gmx: { abbr: "GMX", color: "var(--protocol-gmx)", label: "GMX" },
  pendle: { abbr: "PDL", color: "var(--protocol-pendle)", label: "Pendle" },
  manual: { abbr: "MAN", color: "var(--protocol-manual)", label: "Вручную" },
};

/**
 * `protocol_positions.protocol` → ключ бренда. Версия протокола в строке
 * читателя — деталь источника: Uniswap остаётся Uniswap и в v3, и в v4,
 * а плитка у него одна.
 */
const PROTOCOL_ALIASES: Record<string, string> = {
  uni_v3: "uniswap",
  gmx_v2: "gmx",
};

const FALLBACK: ProtocolBrand = {
  abbr: "—",
  color: "var(--protocol-manual)",
  label: "Протокол",
};

/** Канонический ключ бренда; null — протокола в записи нет. */
export function protocolKey(protocol: string | null | undefined): string | null {
  if (!protocol) return null;
  const key = protocol.toLowerCase();
  return PROTOCOL_ALIASES[key] ?? key;
}

export function protocolBrand(protocol: string | null | undefined) {
  const key = protocolKey(protocol);
  if (key === null) return FALLBACK;
  return PROTOCOL_BRANDS[key] ?? {
    ...FALLBACK,
    abbr: key.slice(0, 3).toUpperCase(),
    label: protocol as string,
  };
}

/** Цвет категории актива — «в чём лежит капитал». */
export const ASSET_COLOR: Record<string, string> = {
  btc: "var(--asset-btc)",
  eth: "var(--asset-eth)",
  stable: "var(--asset-stable)",
};
