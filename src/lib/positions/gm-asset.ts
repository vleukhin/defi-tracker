import type { PositionComponentDto, PositionDto } from "@/lib/api/types";

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
