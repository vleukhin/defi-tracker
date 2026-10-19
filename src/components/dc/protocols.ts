/**
 * Плитки протоколов: аббревиатура и фирменный цвет. Логотипы в дизайне
 * не финальны — плитка рассчитана на подмену аббревиатуры реальным знаком
 * без изменения каркаса шапки карточки (README, «Fidelity»).
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

const FALLBACK: ProtocolBrand = {
  abbr: "—",
  color: "var(--protocol-manual)",
  label: "Протокол",
};

export function protocolBrand(protocol: string | null | undefined) {
  if (!protocol) return FALLBACK;
  return PROTOCOL_BRANDS[protocol.toLowerCase()] ?? {
    ...FALLBACK,
    abbr: protocol.slice(0, 3).toUpperCase(),
    label: protocol,
  };
}

/** Цвет категории актива — «в чём лежит капитал». */
export const ASSET_COLOR: Record<string, string> = {
  btc: "var(--asset-btc)",
  eth: "var(--asset-eth)",
  stable: "var(--asset-stable)",
};
