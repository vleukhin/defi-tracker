/**
 * Геометрия графиков истории (Фаза 3, S3.2). Чистые функции без DOM:
 * графики рисуются инлайновым SVG — библиотек графиков в проекте нет
 * и не появляется.
 *
 * Главное правило: ось X — КАЛЕНДАРНАЯ, а не «номер точки», и серия
 * рвется на пропущенных днях. Прямая линия через две недели без снепшотов
 * была бы ложью о данных, которых не существует (S3.2: «пропущенные дни
 * видны как разрывы, не интерполируются молча»).
 */

const DAY_MS = 86_400_000;

export interface DatedPoint {
  /** Календарный день UTC, YYYY-MM-DD. */
  takenOn: string;
}

/** Номер календарного дня UTC (дни от эпохи) из «YYYY-MM-DD». */
export function dayNumber(takenOn: string): number {
  const ts = Date.parse(`${takenOn}T00:00:00Z`);
  return Number.isNaN(ts) ? Number.NaN : Math.round(ts / DAY_MS);
}

/**
 * Разбиение серии на отрезки ПОДРЯД идущих дней: соседние точки попадают
 * в один отрезок, только если между ними ровно один день. Каждый отрезок
 * рисуется отдельным путем — между отрезками остается физический разрыв.
 */
export function splitRuns<T extends DatedPoint>(points: readonly T[]): T[][] {
  const runs: T[][] = [];
  let current: T[] = [];
  let prevDay = Number.NaN;

  for (const point of points) {
    const day = dayNumber(point.takenOn);
    if (current.length > 0 && day - prevDay === 1) {
      current.push(point);
    } else {
      if (current.length > 0) runs.push(current);
      current = [point];
    }
    prevDay = day;
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** Сколько календарных дней между точками осталось без снепшота. */
export function countMissingDays(points: readonly DatedPoint[]): number {
  let missing = 0;
  for (let i = 1; i < points.length; i += 1) {
    const gap = dayNumber(points[i].takenOn) - dayNumber(points[i - 1].takenOn);
    if (gap > 1) missing += gap - 1;
  }
  return missing;
}

/**
 * Календарная шкала X. Точка занимает «полосу» своего дня, координата —
 * центр полосы: линия стоимости и столбцы пропорций встают на одну сетку,
 * а дни без снепшота остаются пустыми полосами.
 */
export interface TimeScale {
  /** Номер первого дня периода. */
  firstDay: number;
  /** Номер последнего дня периода. */
  lastDay: number;
  /** Ширина периода в днях, включительно (≥ 1). */
  span: number;
  /** Ширина одного дня в процентах ширины графика. */
  slot: number;
}

export function timeScale(points: readonly DatedPoint[]): TimeScale | null {
  if (points.length === 0) return null;
  const firstDay = dayNumber(points[0].takenOn);
  const lastDay = dayNumber(points[points.length - 1].takenOn);
  const span = Math.max(1, lastDay - firstDay + 1);
  return { firstDay, lastDay, span, slot: 100 / span };
}

/** Центр дневной полосы в процентах ширины графика (0…100). */
export function bandCenter(scale: TimeScale, takenOn: string): number {
  const offset = dayNumber(takenOn) - scale.firstDay;
  return ((offset + 0.5) / scale.span) * 100;
}

/** Левый край дневной полосы в процентах ширины графика. */
export function bandLeft(scale: TimeScale, takenOn: string): number {
  return ((dayNumber(takenOn) - scale.firstDay) / scale.span) * 100;
}

/**
 * Зоны наведения: каждая точка получает половину расстояния до соседей.
 * Вся ширина покрыта без нахлестов, и редкие точки (три снепшота за 90
 * дней) остаются попадаемыми мышью, а не пиксельными.
 */
export function hitRegions(
  xs: readonly number[],
): { left: number; width: number }[] {
  if (xs.length === 0) return [];
  if (xs.length === 1) return [{ left: 0, width: 100 }];
  return xs.map((x, i) => {
    const left = i === 0 ? 0 : (xs[i - 1] + x) / 2;
    const right = i === xs.length - 1 ? 100 : (x + xs[i + 1]) / 2;
    return { left, width: Math.max(0, right - left) };
  });
}

/** Округленная шкала Y: «круглые» подписи вместо $153 287,41. */
export interface ValueAxis {
  min: number;
  max: number;
  ticks: number[];
}

const NICE_STEPS = [1, 2, 2.5, 5, 10];

/**
 * 3–4 линии сетки с круглым шагом. Домен НЕ прибивается к нулю: у портфеля
 * в $150k дневные движения на фоне нуля были бы неотличимы от прямой —
 * поэтому нижняя подпись оси всегда показана явно.
 */
export function niceTicks(min: number, max: number, target = 4): ValueAxis {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1, ticks: [0, 1] };
  }

  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (hi === lo) {
    // Плоская серия: раздвигаем домен, иначе делить на ноль
    const pad = Math.max(Math.abs(hi) * 0.05, 1);
    lo -= pad;
    hi += pad;
  }

  const rawStep = (hi - lo) / Math.max(1, target - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const multiplier =
    NICE_STEPS.find((s) => normalized <= s + 1e-9) ?? NICE_STEPS.at(-1)!;
  const step = multiplier * magnitude;

  const domainMin = Math.floor(lo / step) * step;
  const domainMax = Math.ceil(hi / step) * step;

  // Шаг может быть дробным (0,25) — округляем до его же разрядности,
  // чтобы подписи не превращались в 0,30000000000000004
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const round = (v: number) => Number(v.toFixed(decimals));

  const ticks: number[] = [];
  for (let v = domainMin; v <= domainMax + step / 2; v += step) {
    ticks.push(round(v));
  }
  return { min: round(domainMin), max: round(domainMax), ticks };
}

/** Доля значения в домене сверху вниз, 0…100 (0 — верх графика). */
export function yPercent(axis: ValueAxis, value: number): number {
  const range = axis.max - axis.min;
  if (range === 0) return 50;
  return (1 - (value - axis.min) / range) * 100;
}

/**
 * Индексы подписей оси X по ФАКТИЧЕСКОЙ позиции точек, а не по их номеру:
 * ось календарная, и равномерный шаг по индексу ставит подписи вплотную
 * там, где точки сгущаются. Гарантируется минимальный зазор `minGap`
 * (в процентах ширины) — крайние подписи сохраняются всегда.
 */
export function pickTicksByX(
  xs: readonly number[],
  count: number,
  minGap: number,
): number[] {
  const n = xs.length;
  if (n === 0) return [];
  if (n === 1 || count <= 1) return [n - 1];

  // Ближайшая точка к каждой из `count` равномерных позиций
  const first = xs[0];
  const last = xs[n - 1];
  const picked = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const target = first + ((last - first) * i) / (count - 1);
    let best = 0;
    for (let j = 1; j < n; j += 1) {
      if (Math.abs(xs[j] - target) < Math.abs(xs[best] - target)) best = j;
    }
    picked.add(best);
  }

  const sorted = [...picked].sort((a, b) => a - b);
  const kept: number[] = [];
  for (const index of sorted) {
    if (kept.length === 0 || xs[index] - xs[kept[kept.length - 1]] >= minGap) {
      kept.push(index);
    }
  }
  // Последняя подпись обязательна; предыдущую убираем, если она вплотную
  const lastIndex = sorted[sorted.length - 1];
  if (kept[kept.length - 1] !== lastIndex) {
    while (
      kept.length > 0 &&
      xs[lastIndex] - xs[kept[kept.length - 1]] < minGap
    ) {
      kept.pop();
    }
    kept.push(lastIndex);
  }
  return kept;
}

/** «12.345» — координата SVG без хвоста плавающей точки. */
function coord(value: number): string {
  return Number(value.toFixed(3)).toString();
}

export interface PlotPoint {
  x: number;
  y: number;
}

/** Ломаная по точкам отрезка; одна точка линии не дает (рисуется маркером). */
export function linePath(points: readonly PlotPoint[]): string {
  if (points.length < 2) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${coord(p.x)} ${coord(p.y)}`)
    .join(" ");
}

/** Заливка под ломаной до низа графика (baseline = 100). */
export function areaPath(points: readonly PlotPoint[]): string {
  if (points.length < 2) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L${coord(last.x)} 100 L${coord(first.x)} 100 Z`;
}
