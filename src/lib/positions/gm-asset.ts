import type { PositionComponentDto, PositionDto } from "@/lib/api/types";
import { chainLabel } from "@/lib/format";
import { FREE_DUST_USD } from "@/lib/portfolio/portfolio";

/**
 * Базовый актив GM-пула — тот, по цене которого стратегия считает уровни
 * (docs/07 §5) и ведёт рабочий сплит (§8).
 *
 * У двустороннего рынка (BTC/USD [BTC-USDC]) это длинная сторона: короткая
 * всегда стейбл и рынок не определяет. У рынка на одном активе (BTC/USD
 * [BTC-BTC], ETH/USD [ETH-ETH]) сторон нет вовсе — один токен обслуживает
 * и длинную, и короткую половину, читатель пишет его одним компонентом без
 * стороны (chains/gmx.ts), и базовый актив — он.
 *
 * Признак одноактивного пула здесь не флаг в payload, а сама форма состава:
 * единственный компонент без стороны. Двусторонний рынок такой формы не
 * даёт никогда — у него ровно два компонента, long и short, — а флаг в
 * payload пришлось бы держать в согласии с составом, который его и так
 * однозначно описывает.
 *
 * Обе функции рассчитаны на позиции GMX; на позициях других протоколов
 * (у депозита Fluid тоже один компонент без стороны) их смысла нет.
 */

/** Компонент базового актива; null — состав не опознан. */
export function gmBaseComponent(
  position: PositionDto,
): PositionComponentDto | null {
  const long = position.components.find((c) => c.side === "long");
  if (long) return long;
  return isSingleAssetGm(position) ? position.components[0] : null;
}

/** Пул на одном активе: стейблов в нём нет, сторон тоже. */
export function isSingleAssetGm(position: PositionDto): boolean {
  return (
    position.components.length === 1 && position.components[0].side === null
  );
}

/** Место вне кошелька на Arbitrum, где лежит часть GM-позиции. */
export interface GmPlace {
  /** «на Ethereum», «в балансе GMX». */
  label: string;
  quantity: number;
  /** Там лежит вся позиция — количество в мета-строке не повторяется. */
  whole: boolean;
}

/**
 * Где лежит GM позиции, кроме кошелька на Arbitrum: OFT-токеном на других
 * сетях и кредитом внутри GMX.
 *
 * Часть дешевле доллара не показывается — то же правило пыли, что у
 * позиций и свободных средств (FREE_DUST_USD). Остаток округления внутри
 * GMX иначе давал бы чип «часть в балансе GMX» ради сотой доли цента
 * рядом с позицией на $21 000. Стоимость части неизвестна (позиция не
 * оценена) — часть показывается: неизвестно ≠ мало.
 */
export function gmPlaces(position: PositionDto): GmPlace[] {
  const total = position.quantity === null ? null : Number(position.quantity);
  const parts = [
    ...(position.gm?.bridged ?? []).map((h) => ({
      label: `на ${chainLabel(h.chain)}`,
      quantity: h.quantity,
    })),
    { label: "в балансе GMX", quantity: position.gm?.multichainQuantity ?? 0 },
  ];
  return parts
    .filter((part) => part.quantity > 0)
    .filter((part) => {
      if (position.valueUsd === null || total === null || total <= 0) return true;
      return (part.quantity / total) * position.valueUsd >= FREE_DUST_USD;
    })
    .map((part) => ({
      ...part,
      // С допуском: количество приходит строкой и числом из разных
      // округлений, и «вся позиция» не должна зависеть от 1e-12
      whole: total !== null && part.quantity >= total * (1 - 1e-9),
    }));
}
