"use client";

import { CircleAlert, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  PositionDto,
  PositionsSummaryDto,
  StableBorrowRateDto,
  ZonesSummaryDto,
} from "@/lib/api/types";
import { tableUsd } from "@/lib/format";
import { ApiError, apiFetch, useApi } from "@/lib/use-api";
import { PositionCard } from "./position-card";
import { LABEL, type MarkPatch } from "./shared";
import { ZoneCard } from "./zone-card";

/**
 * Экран «Зоны» (Фаза 6) — разрез портфеля по стратегии Capital Growth
 * (docs/07-strategia-capital-growth.md).
 *
 * Зоны НЕ дублируют три категории: категория отвечает «в чем лежит»
 * (BTC / ETH / стейблы), зона — «какую задачу решает». Стейблкоины есть
 * и в Stability, и в Yield, поэтому один разрез через другой не выражается.
 *
 * Внизу — разметка позиций. По стратегии собственные стейблы всегда
 * распределены по позициям зон Yield и Stability, поэтому категория
 * «Стейблы» складывается именно из этих пометок, а не вводится одним числом.
 *
 * Вложенное задается ДВУМЯ числами — своим и заемным. Одной величиной
 * не обойтись: остаток «стоимость − свое» бывает и заемной частью, и
 * начисленным доходом. На депозите Fluid такой остаток был доходом,
 * а показывался как долг.
 *
 * Разметка живет в поповере за кнопкой, а не в карточке: правят ее редко —
 * при заведении позиции и при выводе, — а читают каждый день. Форма
 * из четырех контролов в каждой строке отнимала место у чисел, ради
 * которых на экран и заходят.
 *
 * Сами карточки разбираются по протоколу (components/zones/*-card.tsx):
 * у депозита лендинга и у пула ликвидности разные вопросы к позиции.
 */

interface ZonesResponse {
  zones: ZonesSummaryDto;
  positions: PositionDto[];
  positionsSummary: PositionsSummaryDto;
  /** Стоимость заемных стейблов — порог для ставок Yield-позиций. */
  stableBorrow: StableBorrowRateDto;
  assetsUsd: number | null;
  stableCategoryUsd: number;
}

export function ZonesScreen() {
  const { data, error, loading, refetch } = useApi<ZonesResponse>("/api/zones");
  const [busy, setBusy] = useState(false);
  // Одно «сейчас» на весь список: таймеры карточек не должны разъезжаться
  // между соседними позициями
  const nowMs = useNowMs();

  /** true = сохранилось; форма в поповере по этому признаку закрывается. */
  async function mark(position: PositionDto, patch: MarkPatch) {
    setBusy(true);
    try {
      const [protocol, chain, externalId] = splitKey(position.zoneKey);
      await apiFetch("/api/positions/mark", {
        method: "PUT",
        body: JSON.stringify({ protocol, chain, externalId, ...patch }),
      });
      await refetch();
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

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <CircleAlert className="size-4" />
        <AlertTitle>Не удалось загрузить зоны: {error}</AlertTitle>
        <AlertDescription>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            className="mt-2"
          >
            Повторить
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  const {
    zones,
    positions,
    positionsSummary,
    stableBorrow,
    assetsUsd,
    stableCategoryUsd,
  } = data;

  return (
    <div className="space-y-4">
      {zones.unmarkedPositions > 0 && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>
            Позиций без разметки: {zones.unmarkedPositions}
          </AlertTitle>
          <AlertDescription>
            Пока не указаны обе вложенные суммы, доход позиции не считается, а
            неразмеченная собственная часть занижает категорию «Стейблы». После
            перезаливки диапазона CLMM разметку нужно проставить заново.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {zones.zones.map((z) => (
          <ZoneCard key={z.zone} zone={z} />
        ))}
      </div>

      {/* Сверка. Сумма зон обязана совпасть с Активами; собственные доли
          позиций обязаны совпасть с категорией «Стейблы» */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold">Сверка</h2>
        <dl className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Metric
            label="Сумма зон"
            value={zones.totalUsd === null ? "—" : tableUsd(zones.totalUsd)}
          />
          <Metric
            label="Активы"
            value={assetsUsd === null ? "—" : tableUsd(assetsUsd)}
          />
          <Metric
            label="Своих в позициях"
            value={tableUsd(zones.ownInPositionsUsd)}
          />
          <Metric
            label="Категория «Стейблы»"
            value={tableUsd(stableCategoryUsd)}
          />
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          Собственные доли позиций и образуют категорию «Стейблы» — разница
          между ними это свободные стейблы, не вложенные никуда.
        </p>
        {positionsSummary.unpricedCount > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Позиций без оценки: {positionsSummary.unpricedCount} — суммы с ними
            не выводятся.
          </p>
        )}
      </Card>

      {positions.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-base font-medium">Позиций нет</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Здесь появятся депозиты Fluid, GM-пулы и LP-позиции, когда они будут
            прочитаны с кошельков.
          </p>
        </Card>
      ) : (
        <Card className="p-4">
          <h2 className="text-sm font-semibold">Позиции</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Доход считается как «стоимость + выведено − вложено»: иначе продажа
            части GM с переводом BTC/ETH в залог выглядела бы убытком, хотя
            капитал просто переехал в Growth. Из текущих собственных долей
            складывается категория «Стейблы». Зона и вложенные суммы правятся в
            разметке позиции — кнопка справа в строке.
          </p>
          <ul className="mt-3 space-y-3">
            {positions.map((p) => (
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
        </Card>
      )}
    </div>
  );
}

/**
 * «Сейчас» с обновлением раз в минуту: обратный отсчет 48 часов на карточке
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className={LABEL}>{label}</dt>
      <dd className="font-mono text-sm font-semibold">{value}</dd>
    </div>
  );
}
