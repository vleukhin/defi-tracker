"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DcCard, EmptyState } from "@/components/dc/card";
import { Chip, StatusChip, ZONE_LABEL, zoneColor } from "@/components/dc/chip";
import { HelpTip } from "@/components/dc/help-tip";
import { FilterChips } from "@/components/dc/segmented";
import { countLabel } from "@/components/portfolio/plural";
import type {
  DebtResponseDto,
  FreeBalanceDto,
  PositionDto,
  PositionsSummaryDto,
  StableBorrowRateDto,
  StrategyZone,
  ZonesSummaryDto,
} from "@/lib/api/types";
import { dcUsd } from "@/lib/format";
import { ApiError, apiFetch } from "@/lib/use-api";
import { AaveCard } from "./aave-card";
import { FreeFundsCard, type FreeSummary } from "./free-funds-card";
import { PositionCard } from "./position-card";
import type { MarkPatch } from "./shared";
import { ZoneCard } from "./zone-card";

/**
 * Разрез портфеля по зонам стратегии Capital Growth
 * (docs/07-strategia-capital-growth.md) — тело режима «Зоны».
 *
 * Зоны НЕ дублируют три категории: категория отвечает «в чём лежит»
 * (BTC / ETH / стейблы), зона — «какую задачу решает». Стейблкоины есть
 * и в Stability, и в Yield, поэтому один разрез через другой не выражается.
 *
 * Сверка стоит отдельной полосой и держит два инварианта разом: сумма зон
 * равна «Активам», а собственные доли позиций — категории «Стейблы».
 * Расхождение здесь означает ошибку в разметке, и увидеть его надо раньше,
 * чем принимать по числам решения.
 *
 * Разметка позиции живёт в поповере за кнопкой в шапке карточки: правят её
 * при заведении позиции и при выводе, а читают каждый день.
 */

interface ZonesData {
  zones: ZonesSummaryDto;
  positions: PositionDto[];
  positionsSummary: PositionsSummaryDto;
  /** Стоимость заёмных стейблов — порог для ставок Yield-позиций. */
  stableBorrow: StableBorrowRateDto;
  assetsUsd: number | null;
  stableCategoryUsd: number;
  /** Свободные средства кошельков — плоским списком, без пыли и «прочего». */
  free: FreeBalanceDto[];
  freeSummary: FreeSummary;
}

export type { ZonesData };

const POSITIONS_HINT =
  "Доход позиции — «стоимость + выведено − вложено»: перевод BTC/ETH в залог не выглядит убытком, капитал просто переехал в другую зону.";
const SANITY_HINT =
  "Сумма зон обязана совпасть с активами. Категорию «Стейблы» образуют собственные доли позиций, записи вручную и свободные стейблы на кошельках — последние теперь видно числом в карточке «Свободные средства».";

type ZoneFilter = StrategyZone | "all";

const FILTERS: { value: ZoneFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "growth", label: ZONE_LABEL.growth },
  { value: "yield", label: ZONE_LABEL.yield },
  { value: "stability", label: ZONE_LABEL.stability },
];

export function ZonesScreen({
  data,
  debt,
  onRefetch,
}: {
  data: ZonesData;
  /** Займы: в /api/zones их нет, они приходят отдельным ответом. */
  debt: DebtResponseDto | null;
  onRefetch: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<ZoneFilter>("all");
  // Одно «сейчас» на весь список: таймеры соседних карточек не должны
  // разъезжаться между собой
  const nowMs = useNowMs();

  const {
    zones,
    positions,
    positionsSummary,
    stableBorrow,
    assetsUsd,
    stableCategoryUsd,
    free,
    freeSummary,
  } = data;

  const visible = useMemo(
    () =>
      filter === "all" ? positions : positions.filter((p) => p.zone === filter),
    [positions, filter],
  );

  /**
   * Займы в списке позиций. В модели данных заём — не позиция
   * (`PositionProtocol` знает только fluid / gmx_v2 / uni_v3), он живёт
   * долговой строкой в /api/debt. Но на экране это ровно такой же объект
   * учёта, и по стратегии залог под заём — зона Growth, поэтому карточка
   * встаёт в тот же список и слушается того же фильтра.
   */
  const loans = useMemo(() => {
    if (!debt || (filter !== "all" && filter !== "growth")) return [];
    // Порог берётся из того же ответа, что и сами займы: подставлять
    // умолчание было бы враньём — оно расходится с настройкой пользователя
    const threshold = debt.summary.hfWarningThreshold;
    return debt.chains
      .filter((c) => (c.totalDebtUsd ?? 0) > 0)
      .map((chain) => ({ chain, threshold }));
  }, [debt, filter]);

  /** true = сохранилось; форма в поповере по этому признаку закрывается. */
  async function mark(position: PositionDto, patch: MarkPatch) {
    setBusy(true);
    try {
      const [protocol, chain, externalId] = splitKey(position.zoneKey);
      await apiFetch("/api/positions/mark", {
        method: "PUT",
        body: JSON.stringify({ protocol, chain, externalId, ...patch }),
      });
      await onRefetch();
      return true;
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Не удалось сохранить разметку",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="grid gap-3 md:grid-cols-3">
        {zones.zones.map((z) => (
          <ZoneCard key={z.zone} zone={z} />
        ))}
      </section>

      <FreeFundsCard
        balances={free}
        summary={freeSummary}
        onRefetch={onRefetch}
      />

      <SanityStrip
        zonesTotalUsd={zones.totalUsd}
        assetsUsd={assetsUsd}
        ownInPositionsUsd={zones.ownInPositionsUsd}
        stableCategoryUsd={stableCategoryUsd}
        unpricedCount={positionsSummary.unpricedCount}
      />

      {zones.unmarkedPositions > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-block border border-line bg-sunken px-card py-3">
          <StatusChip tone="warn">
            {countLabel(
              zones.unmarkedPositions,
              "позиция без разметки",
              "позиции без разметки",
              "позиций без разметки",
            )}
          </StatusChip>
          <p className="t-meta min-w-0 text-text-2">
            Пока не указаны обе вложенные суммы, доход позиции не считается,
            а неразмеченная собственная часть занижает категорию «Стейблы».
          </p>
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
        <div className="flex items-center gap-2.5">
          <h2 className="t-h2">Позиции</h2>
          <span className="text-[13px] text-text-3">
            {visible.length + loans.length}
          </span>
          <HelpTip size="md">{POSITIONS_HINT}</HelpTip>
        </div>
        <FilterChips
          options={FILTERS.map((f) => ({
            value: f.value,
            label:
              f.value === "all" ? (
                f.label
              ) : (
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-[6px] rounded-full"
                    style={{ background: zoneColor(f.value) }}
                  />
                  {f.label}
                </span>
              ),
          }))}
          value={filter}
          onChange={setFilter}
          ariaLabel="Зона позиций"
        />
      </div>

      {visible.length + loans.length === 0 ? (
        <DcCard>
          <EmptyState
            title={
              positions.length === 0
                ? "Позиций пока нет — депозиты, GM-пулы и LP появятся после чтения кошельков"
                : "В этой зоне позиций нет"
            }
          />
        </DcCard>
      ) : (
        /* Карточки позиций лежат на фоне страницы, а не внутри общей
           карточки: вложенная карточка в карточке спорит с elevation */
        <ul className="flex flex-col gap-3">
          {/* Заём идёт первым: он единственный, что способен принудительно
              прервать стратегию, и читать его надо раньше доходных позиций */}
          {loans.map(({ chain, threshold }) => (
            <AaveCard
              key={`loan-${chain.chain}`}
              chain={chain}
              hfWarningThreshold={threshold}
              borrowRatePercent={stableBorrow.ratePercent}
            />
          ))}
          {visible.map((p) => (
            <PositionCard
              key={p.id}
              position={p}
              positions={positions}
              busy={busy}
              onMark={mark}
              stableBorrow={stableBorrow}
              nowMs={nowMs}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Полоса «Сверка»: два равенства, которые обязаны сойтись на реальных
 * данных. Проверка держится чипами, а не абзацем — расхождение видно
 * по цвету статуса, а его величина стоит рядом числом.
 */
function SanityStrip({
  zonesTotalUsd,
  assetsUsd,
  ownInPositionsUsd,
  stableCategoryUsd,
  unpricedCount,
}: {
  zonesTotalUsd: number | null;
  assetsUsd: number | null;
  ownInPositionsUsd: number;
  stableCategoryUsd: number;
  unpricedCount: number;
}) {
  // Округление до доллара: суммы сходятся с точностью до центов
  const diff =
    zonesTotalUsd === null || assetsUsd === null
      ? null
      : zonesTotalUsd - assetsUsd;

  return (
    <section className="flex flex-wrap items-center gap-2 rounded-block border border-line bg-sunken px-card py-3">
      <span className="mr-1 flex items-center gap-1.5">
        <span className="t-label">Сверка</span>
        <HelpTip>{SANITY_HINT}</HelpTip>
      </span>

      <SanityChip label="сумма зон" value={zonesTotalUsd} />
      <span aria-hidden className="text-[12px] text-text-4">
        =
      </span>
      <SanityChip label="активы" value={assetsUsd} />

      {diff !== null ? (
        Math.abs(diff) < 0.5 ? (
          <StatusChip tone="profit" className="h-[26px] text-[12px]">
            ✓ сходится
          </StatusChip>
        ) : (
          <StatusChip tone="loss" className="h-[26px] text-[12px]">
            расходится на {dcUsd(Math.abs(diff))}
          </StatusChip>
        )
      ) : (
        <Chip className="h-[26px] px-2.5 text-[12px]">
          {unpricedCount > 0
            ? `${countLabel(unpricedCount, "позиция", "позиции", "позиций")} без оценки`
            : "сверка недоступна"}
        </Chip>
      )}

      <span className="min-w-3 flex-1" />

      <span className="flex flex-wrap items-center gap-x-[7px] gap-y-1 text-[12.5px]">
        <span className="text-text-3">своих в позициях</span>
        <span className="font-medium">{dcUsd(ownInPositionsUsd)}</span>
        <span aria-hidden className="text-text-4">
          ·
        </span>
        <span className="text-text-3">категория «Стейблы»</span>
        <span className="font-medium">{dcUsd(stableCategoryUsd)}</span>
      </span>
    </section>
  );
}

function SanityChip({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <Chip className="h-[26px] gap-[7px] px-2.5 text-[12.5px] font-normal">
      <span className="text-text-3">{label}</span>
      <span className="font-medium text-text-1">
        {value === null ? "—" : dcUsd(value)}
      </span>
    </Chip>
  );
}

/**
 * «Сейчас» с обновлением раз в минуту: обратный отсчёт 48 часов на карточке
 * LP должен идти, а не застывать на времени открытия экрана.
 */
function useNowMs(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function splitKey(key: string): [string, string, string] {
  const [protocol, chain, ...rest] = key.split(":");
  return [protocol, chain, rest.join(":")];
}
