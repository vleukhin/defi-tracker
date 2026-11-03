/**
 * Идентификаторы источников чтения Фазы 5.
 *
 * Вынесены из chains/*: те модули помечены "server-only" и тянут viem, а эти
 * же строки нужны роутам и сборщикам, которым цепочка ни к чему. Значения
 * совпадают с protocol_positions.protocol и chain_read_status.source.
 */

export const FLUID_SOURCE = "fluid" as const;
export const GMX_SOURCE = "gmx_v2" as const;
export const UNIV3_SOURCE = "uni_v3" as const;
export const PENDLE_SOURCE = "pendle" as const;

/**
 * Депозит стейблов на Aave v3 — размещение, а не залог, поэтому источник
 * свой, отдельный от 'aave_v3'.
 *
 * Залог (`aave_v3`) и долг (`aave_v3_debt`) — состояние заёмной позиции:
 * у них нет ни ставки, ни зоны, ни разметки «свои / заёмные», а зона у
 * залога по стратегии одна. Внесённые на тот же рынок стейблы — тот же
 * инструмент, что депозит Fluid (docs/07 §3): доход начисляется ставкой,
 * и держат его ровно пока ставка выше ставки по займу. Поэтому он читается
 * своим контуром и живёт позицией.
 */
export const AAVE_SUPPLY_SOURCE = "aave_v3_supply" as const;

export const POSITION_SOURCES = [
  FLUID_SOURCE,
  GMX_SOURCE,
  UNIV3_SOURCE,
  PENDLE_SOURCE,
  AAVE_SUPPLY_SOURCE,
] as const;

/**
 * Свободные средства на кошельке (нативная монета + ERC-20 по allowlist).
 *
 * В POSITION_SOURCES намеренно не входит: это не протокол размещения,
 * а деньги, которые еще никуда не положены. Строк в protocol_positions
 * не порождает — только balances_cache и статус чтения.
 */
export const ERC20_SOURCE = "erc20" as const;

/** Подписи протоколов для интерфейса. */
export const PROTOCOL_LABELS: Record<
  (typeof POSITION_SOURCES)[number],
  string
> = {
  fluid: "Fluid",
  gmx_v2: "GMX v2",
  uni_v3: "Uniswap v3",
  pendle: "Pendle",
};
