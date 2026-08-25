import { cn } from "@/lib/utils";

/**
 * Разметка вокруг графиков, общая для всех карточек «Истории» и «Долга»:
 * метка недостоверной точки и примечание под графиком.
 *
 * Сами графики рисует Recharts (recharts-parts.tsx) — сюда попало только
 * то, что живёт в HTML рядом с ними: и метка, и примечание должны совпадать
 * по виду, иначе легенда под графиком перестаёт объяснять сам график.
 */

/**
 * Точка «частичные данные»: отличается ФОРМОЙ (полая), а не только цветом.
 * Единственный случай семантики в графике — это статус достоверности точки,
 * а не результат (дизайн-код §2).
 */
export function PartialMarker({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 rounded-full border-2 border-warn bg-sunken",
        className,
      )}
    />
  );
}

/**
 * Примечание под графиком: разрывы и частичные точки. Цвет никогда
 * не единственный сигнал — у полой точки другая форма, у разрыва
 * подписано число дней.
 */
export function ChartNote({
  missing,
  anyPartial,
  /**
   * Чем именно вызваны разрывы. На графике стоимости это дни без снепшота;
   * на графике количества к ним добавляются дни, в которые снепшот есть,
   * но цены категории не было и количество не выведено.
   */
  missingLabel = "дни без снепшота",
  /** Своя оговорка карточки — например, сколько точек осталось без Прибыли. */
  extra,
  className,
}: {
  missing: number;
  anyPartial: boolean;
  missingLabel?: string;
  extra?: React.ReactNode;
  className?: string;
}) {
  if (missing === 0 && !anyPartial && !extra) return null;
  return (
    <div
      className={cn(
        "t-meta flex flex-wrap items-center gap-x-4 gap-y-1 text-text-3",
        className,
      )}
    >
      {anyPartial && (
        <span className="inline-flex items-center gap-1.5">
          <PartialMarker />
          частичные данные
        </span>
      )}
      {missing > 0 && (
        <span>
          разрывы — {missingLabel}: <span className="font-mono">{missing}</span>
        </span>
      )}
      {extra}
    </div>
  );
}
