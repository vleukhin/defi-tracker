/**
 * Календарь графиков (Фаза 3, S3.2). Чистые функции без DOM: сами графики
 * рисует Recharts (components/history/recharts-parts.tsx), а отсюда берётся
 * всё, что должно совпадать у шести карточек на трёх экранах, — нумерация
 * дней, плотный ряд с пропусками, шкала времени и деления оси значений.
 *
 * Главное правило: ось X — КАЛЕНДАРНАЯ, а не «номер точки», и серия
 * рвётся на пропущенных днях. Прямая линия через две недели без снепшотов
 * была бы ложью о данных, которых не существует (S3.2: «пропущенные дни
 * видны как разрывы, не интерполируются молча»). Выражен разрыв дырой
 * в самих данных: denseDays ставит null, Recharts не соединяет через него.
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

/** Обратное к dayNumber: номер календарного дня UTC → «YYYY-MM-DD». */
export function dateFromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
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

/** Календарный день периода: point === null — снепшота в этот день не было. */
export interface DenseDay<T> {
  takenOn: string;
  point: T | null;
}

/**
 * Разрыв, выраженный ДАННЫМИ: каждый календарный день периода получает
 * строку, дни без снепшота — point: null. Так рвут линию библиотеки
 * графиков (connectNulls={false}) — им нужен ряд, в котором пропуск
 * физически есть, а не подразумевается расстоянием между датами.
 *
 * Ряд считается по календарю, а не по индексам: три снепшота за 90 дней
 * дадут 90 строк, из которых заполнены три, — и расстояния между точками
 * останутся честными.
 */
export function denseDays<T extends DatedPoint>(
  points: readonly T[],
): DenseDay<T>[] {
  const scale = timeScale(points);
  if (scale === null) return [];

  const byDay = new Map<number, T>();
  for (const point of points) byDay.set(dayNumber(point.takenOn), point);

  const days: DenseDay<T>[] = [];
  for (let day = scale.firstDay; day <= scale.lastDay; day += 1) {
    const point = byDay.get(day);
    days.push({ takenOn: dateFromDay(day), point: point ?? null });
  }
  return days;
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

/**
 * Доля высоты, на которой лежит ноль, 0…1 сверху вниз — точка стыка цвета
 * у знакопеременного ряда (Прибыль).
 *
 * Считается ПО ЗНАЧЕНИЯМ, а не по домену оси. У SVG-градиента по умолчанию
 * gradientUnits="objectBoundingBox": 0…1 отмеряются по bbox самого пути,
 * а не по полю графика. Домен из niceTicks шире данных — границы округлены
 * наружу, — и offset по домену поставил бы стык мимо нуля, молча и без
 * ошибки. Нули в min/max нужны потому, что заливка с baseValue={0} всегда
 * дотягивается до нулевой линии, даже если сам ряд её не пересекает.
 *
 * Ряд целиком выше нуля даёт 1 (весь путь по одну сторону стыка), целиком
 * ниже — 0, плоский нулевой — 0,5.
 */
export function signGradientOffset(
  values: readonly (number | null)[],
): number {
  const finite = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  const hi = Math.max(...finite, 0);
  const lo = Math.min(...finite, 0);
  if (hi === lo) return 0.5;
  return hi / (hi - lo);
}
