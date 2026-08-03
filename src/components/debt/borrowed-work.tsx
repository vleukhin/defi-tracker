import { DcCard, SectionHead, Verdict } from "@/components/dc/card";
import { ProtocolTile } from "@/components/dc/page-header";
import { protocolBrand } from "@/components/dc/protocols";
import { Dash } from "@/components/dc/table";
import type { PositionDto } from "@/lib/api/types";
import { dcPp, dcRate, dcUsd } from "@/lib/format";
import { isStableSymbol } from "@/lib/stables";
import { cn } from "@/lib/utils";

/**
 * «Где работают заёмные» (README §6): во что вложены занятые деньги
 * и дороже ли размещение, чем сам заём.
 *
 * Спред считается только для стейбл-размещений (docs/07 §3): ставка
 * в ETH — про другой риск и другую валюту, и правило «депозит держат,
 * пока он дороже займа» на неё не распространяется. У пулов ставки нет
 * вовсе — доход там считается по стоимости, поэтому в колонке «—».
 */

/** protocol_positions.protocol → бренд плитки. */
const TILE_KEY: Record<string, string> = {
  fluid: "fluid",
  gmx_v2: "gmx",
  uni_v3: "uniswap",
};

/** Ставка позиции целиком: награды без базовой ставкой не являются. */
export function positionRate(position: PositionDto): number | null {
  const base = position.supplyRatePercent;
  return base === null ? null : base + (position.rewardsRatePercent ?? 0);
}

/** Спред к займу в п.п.; null = сравнивать не с чем или не с чем сравнивать. */
export function positionSpread(
  position: PositionDto,
  borrowRatePercent: number | null,
): number | null {
  const rate = positionRate(position);
  if (rate === null || borrowRatePercent === null) return null;
  if (!position.components.some((c) => isStableSymbol(c.symbol))) return null;
  return rate - borrowRatePercent;
}

export function BorrowedWork({
  positions,
  borrowRatePercent,
  freeStablesUsd,
  loading,
}: {
  positions: PositionDto[];
  borrowRatePercent: number | null;
  /** Свои стейблы вне позиций; null = разрез недоступен. */
  freeStablesUsd: number | null;
  /** Позиции ещё грузятся: «пусто» и «не дочитали» — разные состояния. */
  loading?: boolean;
}) {
  const sorted = [...positions].sort(
    (a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1),
  );
  const spreads = sorted
    .map((p) => positionSpread(p, borrowRatePercent))
    .filter((s): s is number => s !== null);

  return (
    <DcCard as="section" className="flex flex-col">
      <SectionHead
        title="Где работают заёмные"
        className="border-line border-b"
        hint="Ставка размещения против ставки займа. Спред показан там, где размещены стейблы: ставку в ETH со стоимостью займа в стейблах не сравнивают."
      />

      {loading && sorted.length === 0 ? (
        <ul aria-busy="true" className="grid gap-px bg-line">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 bg-surface px-card py-3.5">
              <span className="size-[30px] shrink-0 rounded-[10px] bg-chip" />
              <span className="h-[30px] flex-1 rounded-control bg-chip" />
            </li>
          ))}
        </ul>
      ) : sorted.length === 0 && freeStablesUsd === null ? (
        <p className="t-meta px-card py-6 text-text-3">
          Размещённых позиций не прочитано.
        </p>
      ) : (
        <ul className="grid gap-px bg-line">
          {sorted.map((position) => {
            const brand = protocolBrand(
              TILE_KEY[position.protocol] ?? position.protocol,
            );
            const rate = positionRate(position);
            const spread = positionSpread(position, borrowRatePercent);
            return (
              <Row
                key={position.id}
                abbr={brand.abbr}
                color={brand.color}
                title={`${position.protocolLabel} · ${position.title}`}
                note={[
                  position.valueUsd === null ? "—" : dcUsd(position.valueUsd),
                  rate === null ? null : `под ${dcRate(rate)}`,
                ]
                  .filter(Boolean)
                  .join(" ")}
                value={
                  spread === null ? (
                    <Dash />
                  ) : (
                    <span
                      className={cn(spread > 0 ? "text-profit" : "text-loss")}
                    >
                      {dcPp(spread)}
                    </span>
                  )
                }
              />
            );
          })}

          {freeStablesUsd !== null && (
            <Row
              abbr="·"
              color="var(--text-3)"
              title="Свободные стейблы"
              note="не размещены"
              value={
                <span className="font-mono text-text-2">
                  {dcUsd(freeStablesUsd)}
                </span>
              }
            />
          )}
        </ul>
      )}

      <Verdict className="mt-auto">
        {borrowRatePercent === null
          ? "Ставка займа не прочитана — сравнить размещение не с чем."
          : spreads.length === 0
            ? `Заём стоит ${dcRate(borrowRatePercent)} — ставок по размещению нет, доход считается по стоимости.`
            : spreads.every((s) => s > 0)
              ? `Заём стоит ${dcRate(borrowRatePercent)} — размещение дороже.`
              : `Заём стоит ${dcRate(borrowRatePercent)} — часть размещения дешевле займа.`}
      </Verdict>
    </DcCard>
  );
}

/** Строка списка: плитка 30px → название и сумма → число справа. */
function Row({
  abbr,
  color,
  title,
  note,
  value,
}: {
  abbr: string;
  color: string;
  title: string;
  note: string;
  value: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 bg-surface px-card py-3.5">
      <ProtocolTile abbr={abbr} color={color} size={30} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">{title}</p>
        <p className="truncate text-[12px] text-text-3">{note}</p>
      </div>
      <span className="shrink-0 text-[13px] font-medium">{value}</span>
    </li>
  );
}
