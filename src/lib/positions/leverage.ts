import type { LeverageBorrowDto, PositionDto } from "@/lib/api/types";

/**
 * Экран «Левередж» (S5.3) — чистая функция без I/O.
 *
 * По каждому займу: текущая стоимость долга против текущей стоимости
 * профинансированных им позиций, дельта в долларах и процентах. Отвечает
 * ровно на один вопрос — оправдывает ли себя связка «занял и разместил».
 *
 * Привязка — только бухгалтерская метка. На три категории портфеля и на
 * пять чисел она НЕ влияет: положительная дельта не превращается в прибыль
 * сама по себе, она лишь объясняет, откуда прибыль берется.
 *
 * Связь многие-ко-многим в обе стороны: один займ может финансировать
 * несколько позиций, одна позиция — питаться из нескольких займов. Поэтому
 * суммы по займам МОГУТ пересекаться, и итог считается по уникальным
 * сущностям, а не сложением строк.
 */

export interface BorrowInput {
  /** protocol_positions.id долговой строки. */
  id: string;
  chain: string;
  symbol: string;
  quantity: string;
  coingeckoId: string | null;
}

export interface LinkInput {
  borrowId: string;
  positionId: string;
}

export interface BuildLeverageInput {
  positions: PositionDto[];
  borrows: BorrowInput[];
  links: LinkInput[];
  /** Цены по coingecko id (только кэш). */
  pricesUsd: Map<string, number>;
}

export interface BuildLeverageResult {
  borrows: LeverageBorrowDto[];
  linkedDebtUsd: number | null;
  linkedPositionsUsd: number | null;
  linkedDeltaUsd: number | null;
}

/** Сумма с null-пропагацией: неизвестное слагаемое — неизвестная сумма. */
function sumOrNull(values: (number | null)[]): number | null {
  let sum = 0;
  for (const v of values) {
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

export function buildLeverage(
  input: BuildLeverageInput,
): BuildLeverageResult {
  const positionById = new Map(input.positions.map((p) => [p.id, p]));

  const linkedByBorrow = new Map<string, string[]>();
  for (const link of input.links) {
    // Связка на исчезнувшую позицию (вывели средства) молча игнорируется:
    // строка protocol_positions уже удалена, показывать нечего
    if (!positionById.has(link.positionId)) continue;
    const list = linkedByBorrow.get(link.borrowId) ?? [];
    list.push(link.positionId);
    linkedByBorrow.set(link.borrowId, list);
  }

  const debtUsdOf = (b: BorrowInput): number | null => {
    const price =
      b.coingeckoId !== null ? input.pricesUsd.get(b.coingeckoId) : undefined;
    if (price === undefined) return null; // цены нет — оценка неизвестна, не ноль
    return Number.parseFloat(b.quantity) * price;
  };

  const borrows: LeverageBorrowDto[] = input.borrows.map((b) => {
    const linkedPositionIds = linkedByBorrow.get(b.id) ?? [];
    const debtUsd = debtUsdOf(b);
    const linkedUsd =
      linkedPositionIds.length === 0
        ? null
        : sumOrNull(
            linkedPositionIds.map((id) => positionById.get(id)?.valueUsd ?? null),
          );

    const deltaUsd =
      debtUsd === null || linkedUsd === null ? null : linkedUsd - debtUsd;
    const deltaPct =
      deltaUsd === null || debtUsd === null || debtUsd === 0
        ? null
        : (deltaUsd / debtUsd) * 100;

    return {
      id: b.id,
      chain: b.chain,
      symbol: b.symbol,
      quantity: b.quantity,
      debtUsd,
      linkedPositionIds,
      linkedUsd,
      deltaUsd,
      deltaPct,
    };
  });

  // Крупные займы сверху; без привязок — ниже, но видны
  borrows.sort(
    (a, b) =>
      (b.debtUsd ?? -1) - (a.debtUsd ?? -1) || a.symbol.localeCompare(b.symbol),
  );

  // Итоги по УНИКАЛЬНЫМ сущностям: при связи многие-ко-многим сложение
  // строк посчитало бы одну и ту же позицию несколько раз
  const withLinks = borrows.filter((b) => b.linkedPositionIds.length > 0);
  const uniquePositionIds = new Set(
    withLinks.flatMap((b) => b.linkedPositionIds),
  );

  const linkedDebtUsd = sumOrNull(withLinks.map((b) => b.debtUsd));
  const linkedPositionsUsd = sumOrNull(
    [...uniquePositionIds].map((id) => positionById.get(id)?.valueUsd ?? null),
  );
  const linkedDeltaUsd =
    linkedDebtUsd === null || linkedPositionsUsd === null
      ? null
      : linkedPositionsUsd - linkedDebtUsd;

  return { borrows, linkedDebtUsd, linkedPositionsUsd, linkedDeltaUsd };
}
