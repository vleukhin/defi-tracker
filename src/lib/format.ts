/**
 * Форматирование чисел и строк для UI (ТЗ §6.1, S1.7).
 * Денежные суммы: «$ 12 345.67» — неразрывный пробел между тысячами.
 * Количества токенов приходят десятичными СТРОКАМИ — форматируем
 * строковыми операциями, никогда не гоняем через float (потеря точности).
 */

export const NBSP = " ";
/** Типографский минус (U+2212) — визуально согласован с «+». */
export const MINUS = "−";
/** Порог выделения отклонения по умолчанию, п.п. (S1.7). */
export const DEVIATION_THRESHOLD_PP = 5;

/** «12 345» — группировка тысяч неразрывными пробелами. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/* ---------------------------------------------------------------------------
 * Табличный формат (вид рабочей таблицы пользователя): десятичная ЗАПЯТАЯ,
 * фиксированное число знаков с сохранением нулей («53,00%», «1,2611»),
 * знак доллара без отбивки («$81 098»). Нули не срезаются намеренно —
 * так колонки визуально выравниваются, как в таблице.
 * ------------------------------------------------------------------------- */

/** «1 234,5678» — число с запятой и фиксированной точностью. */
export function tableNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? MINUS : "";
  const [int, frac] = Math.abs(value).toFixed(decimals).split(".");
  return `${sign}${groupThousands(int)}${frac ? `,${frac}` : ""}`;
}

/** Как tableNumber, но с явным «+» — знак не должен быть только цветом. */
export function tableSigned(value: number, decimals: number): string {
  const body = tableNumber(value, decimals);
  return value > 0 ? `+${body}` : body;
}

/** «$81 098» / «−$1 234» — как в таблице: без пробела после знака валюты. */
export function tableUsd(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? MINUS : "";
  const [int, frac] = Math.abs(value).toFixed(decimals).split(".");
  return `${sign}$${groupThousands(int)}${frac ? `,${frac}` : ""}`;
}

/**
 * Количество из десятичной СТРОКИ с запятой-разделителем.
 * Обертка над formatQuantity/formatQuantityFull: точность не теряется
 * (все операции строковые), меняется только разделитель.
 */
export function tableQuantity(quantity: string, full = false): string {
  const formatted = full
    ? formatQuantityFull(quantity)
    : formatQuantity(quantity);
  return formatted.replace(".", ",");
}

/** «+$1 234» / «−$1 234» — P/L: плюс показывается явно (не только цветом). */
export function tableUsdSigned(value: number, decimals = 0): string {
  const body = tableUsd(value, decimals);
  return value > 0 ? `+${body}` : body;
}

/**
 * Точность цен и сумм в $: крупные — целые (как в таблице портфеля),
 * мелкие — с копейками ($1,00 у стейблов информативнее, чем $1).
 */
export function usdDecimals(value: number): number {
  return Math.abs(value) >= 1000 ? 0 : 2;
}

/* ---------------------------------------------------------------------------
 * Правила записи чисел дизайн-кода 1.0 (§4). Отличие от table*-хелперов:
 * точность не передаётся вызывающим, а следует из смысла величины —
 * так одна и та же сумма не окажется на двух экранах в разном виде.
 * ------------------------------------------------------------------------- */

/**
 * Деньги: «$25 251» и «$302,91» — копейки только до $1000.
 *
 * Ровный ноль пишется «$0», а не «$0,00»: копейки на нуле ничего
 * не сообщают, и дизайн-код называет «$0,00» отдельно (§4). Это именно
 * ноль, а не «неизвестно» — неизвестное рисуется прочерком.
 */
export function dcUsd(value: number): string {
  if (value === 0) return "$0";
  return tableUsd(value, usdDecimals(value));
}

/** Деньги со знаком: «+$1 240» / «−$2 847». */
export function dcUsdSigned(value: number): string {
  return tableUsdSigned(value, usdDecimals(value));
}

/** Ставка — всегда два знака: «4,90%». */
export function dcRate(value: number): string {
  return tablePct(value, 2);
}

/**
 * Разница ставок и отклонение от цели: «+1,38%».
 *
 * Величина здесь — процентные пункты (абсолютная разница двух процентов),
 * но по решению владельца продукта единица во всём интерфейсе пишется
 * символом процента. Не подставляйте это число в относительные расчёты:
 * «+3,13%» рядом с долей «53,13%» означает «на 3,13 пункта выше цели»,
 * а не «на 3,13% больше».
 */
export function dcPp(value: number, decimals = 2): string {
  return `${tableSigned(value, decimals)}%`;
}

/** Количество токена — 4 знака: «6,9777 WETH». */
export function dcTokens(value: number, symbol?: string): string {
  const body = tableNumber(value, 4);
  return symbol ? `${body}${NBSP}${symbol}` : body;
}

/**
 * Дельта карточки: «−$2 847 · −6,2%» — точка-разделитель, без скобок.
 * Скобки читаются как «в скобках второстепенное», а процент здесь
 * не менее важен, чем сумма.
 */
export function dcDelta(absolute: number, percent: number): string {
  return `${dcUsdSigned(absolute)}${NBSP}·${NBSP}${tableSigned(percent, 1)}%`;
}

/** «29.07.2026» — дата сделки из ISO; UTC, чтобы дата не сдвигалась поясом. */
export function tableDate(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const d = new Date(ts);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

/** «53,00%» — процент с запятой и двумя знаками. */
export function tablePct(value: number, decimals = 2): string {
  return `${tableNumber(value, decimals)}%`;
}

/** «+3,00%» / «−4,15%» — отклонение в процентных пунктах. */
export function tablePctSigned(value: number, decimals = 2): string {
  return `${tableSigned(value, decimals)}%`;
}

/**
 * «$ 12 345.67». По умолчанию 2 знака; decimals: 0 — для сумм
 * ребалансировки («Купить $ 980»). Отрицательные — с типографским минусом.
 */
export function formatUsd(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return `$${NBSP}—`;
  const sign = value < 0 ? MINUS : "";
  const fixed = Math.abs(value).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  return `${sign}$${NBSP}${groupThousands(int)}${frac ? `.${frac}` : ""}`;
}

/** «42.3%» — проценты. В таблице портфеля используется 2 знака (как в ТЗ). */
export function formatPct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * «+7.2%» / «−3.1%» — отклонение со знаком (знак = не только цвет).
 * Величина — процентные пункты, единица пишется процентом: см. `dcPp`.
 */
export function formatPp(value: number, decimals = 1): string {
  const sign = value > 0 ? "+" : value < 0 ? MINUS : "";
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

/**
 * Число с группировкой тысяч и типографским минусом: «1 234.5678».
 * Для количеств категорий (BTC/ETH — 4 знака) и сумм в USD (0 знаков).
 */
export function formatAmount(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? MINUS : "";
  const [int, frac] = Math.abs(value).toFixed(decimals).split(".");
  const trimmed = frac?.replace(/0+$/, "") ?? "";
  return `${sign}${groupThousands(int)}${trimmed ? `.${trimmed}` : ""}`;
}

/**
 * Количество к ребалансировке: со знаком, где плюс значим («купить»),
 * поэтому он показывается явно, а не только цветом.
 */
export function formatSignedAmount(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? MINUS : "";
  const [int, frac] = Math.abs(value).toFixed(decimals).split(".");
  const trimmed = frac?.replace(/0+$/, "") ?? "";
  return `${sign}${groupThousands(int)}${trimmed ? `.${trimmed}` : ""}`;
}

/**
 * Компактное количество токена из десятичной строки:
 * 4 значащие цифры дробной части, только строковые операции (усечение,
 * без округления — округление потребовало бы арифметики).
 * «1234.567891» -> «1 234.5678», «0.000123456» -> «0.0001234».
 * Полное значение показывается отдельно (formatQuantityFull) в title/разбивке.
 */
export function formatQuantity(quantity: string): string {
  const negative = quantity.startsWith("-");
  const unsigned = negative ? quantity.slice(1) : quantity;
  const [intRaw = "0", fracRaw = ""] = unsigned.split(".");
  const int = intRaw.replace(/^0+(?=\d)/, "");
  const grouped = groupThousands(int);
  const prefix = negative ? MINUS : "";

  const firstSignificant = fracRaw.search(/[1-9]/);
  if (firstSignificant === -1) return `${prefix}${grouped}`; // дробь пустая или нули

  // Целая часть ненулевая -> хватит 4 знаков дроби;
  // число < 1 -> ведущие нули + 4 значащие цифры.
  const keep = int === "0" ? firstSignificant + 4 : 4;
  const frac = fracRaw.slice(0, keep).replace(/0+$/, "");
  return frac ? `${prefix}${grouped}.${frac}` : `${prefix}${grouped}`;
}

/** Полное количество с группировкой тысяч, дробная часть без усечения. */
export function formatQuantityFull(quantity: string): string {
  const negative = quantity.startsWith("-");
  const unsigned = negative ? quantity.slice(1) : quantity;
  const [intRaw = "0", frac = ""] = unsigned.split(".");
  const int = groupThousands(intRaw.replace(/^0+(?=\d)/, ""));
  const prefix = negative ? MINUS : "";
  return frac ? `${prefix}${int}.${frac}` : `${prefix}${int}`;
}

/**
 * Относительное время для меток свежести: «только что», «5 мин назад»,
 * «3 ч назад», «2 дн назад». null -> null (вызывающий покажет «—»).
 */
export function formatRelativeTime(
  iso: string | null,
  nowMs: number = Date.now(),
): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 60) return "только что";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}${NBSP}мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}${NBSP}ч назад`;
  const days = Math.floor(hours / 24);
  return `${days}${NBSP}дн назад`;
}

/** «0x1234…abcd» — усечение checksummed-адреса для списков. */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Отображаемые имена сетей (идентификаторы из chains/config). */
export const CHAIN_LABELS: Record<string, string> = {
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  base: "Base",
  optimism: "Optimism",
};

export function chainLabel(chain: string): string {
  return CHAIN_LABELS[chain] ?? chain;
}
