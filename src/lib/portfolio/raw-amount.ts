/**
 * Сырое количество токена (uint256) -> десятичная строка.
 *
 * Почему это отдельный модуль с тестом, а не formatUnits(BigInt(x), d)
 * по месту. balances_cache.raw_amount объявлен numeric(78, 0) — так он
 * вмещает uint256 целиком. PostgREST отдает numeric JSON-числом, и значение
 * порядка 1e21 (тысяча токенов с 18 decimals — обычное дело) возвращается
 * строкой вида "1e+21". BigInt на такой строке бросает SyntaxError, и
 * портфель падал бы целиком из-за одного крупного баланса.
 *
 * Читающий код запрашивает raw_amount::text, но полагаться только на это
 * нельзя: каст легко потерять при следующей правке запроса, а падение
 * будет зависеть от размера баланса — то есть проявится не сразу и не у всех.
 *
 * Мусор трактуется как 0, а не как NaN: тот же принцип, что у toNumber
 * в движке портфеля — неразобранное значение не должно превращать
 * стоимость категории в NaN.
 */

/** Разворачивает экспоненциальную запись целого числа в обычную. */
function expandExponent(value: string): string | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/.exec(value);
  if (!m) return null;
  const [, sign, intPart, fracPart = "", expStr] = m;
  const exp = Number.parseInt(expStr, 10);
  if (exp < fracPart.length) return null; // не целое — для uint256 невозможно
  return `${sign}${intPart}${fracPart}${"0".repeat(exp - fracPart.length)}`;
}

/** Сырое значение из БД -> bigint; неразбираемое -> 0n. */
export function toRawBigInt(raw: string | number | null | undefined): bigint {
  if (raw === null || raw === undefined) return 0n;
  const text = String(raw).trim();
  if (text === "") return 0n;
  const normalized = /^-?\d+$/.test(text) ? text : expandExponent(text);
  if (normalized === null) return 0n;
  try {
    return BigInt(normalized);
  } catch {
    return 0n;
  }
}

/**
 * Количество монет десятичной строкой. Своя реализация, а не formatUnits
 * из viem: этот модуль нужен и там, где цепочечные зависимости не тянутся,
 * а арифметика тривиальна и точна на bigint.
 */
export function rawToQuantity(
  raw: string | number | null | undefined,
  decimals: number,
): string {
  const value = toRawBigInt(raw);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return "0";
  if (decimals === 0) return value.toString();

  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const intPart = digits.slice(0, digits.length - decimals);
  // Хвостовые нули убираются: "1.500000" читается хуже, чем "1.5"
  const fracPart = digits.slice(digits.length - decimals).replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return fracPart === "" ? `${sign}${intPart}` : `${sign}${intPart}.${fracPart}`;
}
