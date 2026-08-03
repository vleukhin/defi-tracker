/**
 * Русское склонение счётных подписей: «1 позиция · 2 позиции · 5 позиций».
 * Нужно ровно там, где число стоит рядом со словом — в мете и счётчиках;
 * в самих метриках числа живут без слов.
 */
export function plural(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** «3 позиции» — число со склонённым словом. */
export function countLabel(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  return `${n} ${plural(n, one, few, many)}`;
}
