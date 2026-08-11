import type { PositionDto } from "@/lib/api/types";

/**
 * Уровни действий по GM-пулу (docs/07 §5, §6, §7).
 *
 * Стратегия привязывает действия не к «сколько потеряли», а к падению цены
 * базового актива от ПОДВИЖНОЙ точки отсчёта: цены на момент входа в пул,
 * переносимой вперёд после того, как на росте LTV довели до 50% (§7).
 * Точка отсчёта задаётся разметкой позиции (`entryPriceUsd`) — вывести её
 * из данных нельзя: стоимость пула меняется и переоценкой, и выводами.
 *
 * Считается по ЦЕНЕ базового актива, а не по стоимости позиции. Это разные
 * величины: часть GM продаётся на уровнях, стоимость от этого падает, а
 * рынок при этом может не двигаться вовсе.
 *
 * Сам по себе модуль знает только, где цена стоит сейчас: `reached` значит
 * «цена не выше уровня», и заход ниже с отскоком между чтениями отсюда не
 * виден. Что на уровне действительно действовали, приложение знает лишь
 * со слов владельца — это приходит вторым аргументом, списком отработанных
 * уровней из журнала операций (docs/09 S8.1). Опрашивать рынок по
 * расписанию мы не стали намеренно: «цена там была» и «я там продавал» —
 * разные факты, а решение на следующем падении зависит от второго.
 *
 * Поэтому «отработан» и «цена сейчас ниже» живут двумя отдельными
 * признаками и не сливаются в один (S8.3). Смешать их — значит соврать
 * в обе стороны сразу: отскок стёр бы отметку о состоявшейся продаже,
 * а падение нарисовало бы действие, которого не было.
 *
 * Функция остаётся чистой и синхронной: журнал читает вызывающий, здесь
 * только арифметика. Без второго аргумента модуль ведёт себя ровно так,
 * как до появления журнала.
 */

/** Уровни падения из §5, в процентах от точки отсчёта. */
export const GM_DROP_LEVELS = [7, 15, 30, 50, 70] as const;

/**
 * Ориентир первой фиксации на росте (§6). Не уровень действия: на
 * промежуточных отметках роста стратегия действий не предусматривает,
 * а здесь «можно продать часть GM».
 */
export const GM_GROWTH_LEVEL_PERCENT = 50;

/**
 * Каким числом ориентир роста лежит в журнале операций (docs/09,
 * «Схема данных»). Уровни падения хранятся положительными процентами
 * падения, и `+50` из §6 столкнулось бы в той же колонке с `50` из §5;
 * минус означает «это рост». На экране остаётся «+50%».
 */
export const GM_GROWTH_LEVEL_KEY = -50;

/**
 * Уровни, отмеченные владельцем как отработанные при ТЕКУЩЕЙ точке
 * отсчёта: те же числа, что в журнале, — 7/15/30/50/70 и −50 для
 * ориентира роста. Записи прошлых циклов сюда не попадают: точка
 * переехала — шкала начинается с чистого листа (S8.2).
 *
 * Итерируемое, а не `Set`, чтобы вызывающий не оборачивал результат
 * запроса ради одного вызова; внутри всё равно нужен поиск по значению.
 */
export type GmActedLevels = Iterable<number>;

/**
 * Что стратегия делает с GM-пулами на уровне (§5, таблица Yield/GM).
 * Утверждения, а не команды: интерфейс говорит, что предусмотрено
 * стратегией, а решает пользователь (дизайн-код §7).
 */
const GM_ACTION: Record<number, string> = {
  7: "GM продают на 30%, BTC/ETH уходят в залог, USDC — снова в GM",
  15: "GM продают полностью, BTC/ETH уходят в залог, USDC — снова в GM",
  30: "текущие GM продают, BTC/ETH уходят в залог, USDC — снова в GM",
  50: "текущие GM продают, BTC/ETH уходят в залог, USDC — снова в GM",
  70: "текущие GM продают, BTC/ETH уходят в залог, USDC — снова в GM",
};

/**
 * Что на том же уровне делает Stability (§5, таблица Stability): с −30%
 * к продажам GM подключаются покупки из резерва. Проценты — от ВСЕГО
 * объёма зоны на начало цикла, а не от остатка.
 */
const STABILITY_ACTION: Record<number, string | null> = {
  7: null,
  15: null,
  30: "30% всей зоны уходит в GM BTC/USDC",
  50: "ещё 40% всей зоны уходит в GM BTC/USDC",
  70: "оставшиеся 30% зоны уходят в GM BTC/USDC",
};

export interface GmLevel {
  /** Падение от точки отсчёта в процентах: 7, 15, 30, 50, 70. */
  dropPercent: number;
  /** Цена базового актива, на которой уровень достигается. */
  priceUsd: number;
  /** Действие стратегии с GM-пулами. */
  action: string;
  /** Действие Stability на этом же уровне; null — зона не трогается. */
  stabilityAction: string | null;
  /**
   * Цена сейчас не выше уровня. null = текущая цена неизвестна, и сказать
   * нечего: ложное «не пройден» здесь опаснее прочерка.
   */
  reached: boolean | null;
  /**
   * Владелец отметил, что на уровне действовал (S8.1). От `reached` не
   * зависит вовсе: отмечают и уровень выше текущей цены — это основной
   * случай после отскока. Неизвестной цене здесь безразлично, поэтому
   * признак булев, а не тернарный.
   */
  acted: boolean;
}

export interface GmLevelsView {
  /** Точка отсчёта; null = не задана, и уровни не считаются. */
  entryPriceUsd: number | null;
  /** Цена базового актива на момент чтения позиции. */
  currentPriceUsd: number | null;
  /** Базовый актив рынка — цена именно его: «BTC», «ETH». */
  marketSymbol: string | null;
  /** Изменение цены от точки отсчёта, %: минус — падение. */
  changePercent: number | null;
  /** Уровни §5 сверху вниз; пустой список = точки отсчёта нет. */
  levels: GmLevel[];
  /** Сколько уровней пройдено; null = текущая цена неизвестна. */
  reachedCount: number | null;
  /** Самый глубокий пройденный уровень; null — ни одного или цены нет. */
  lastReached: GmLevel | null;
  /**
   * Уровень, на котором ещё предстоит действовать: первый непройденный
   * ценой И не отмеченный отработанным. null — не осталось таких или
   * цены нет. Отмеченный уровень пропускается даже когда цена отскочила
   * выше него: вести к уже выполненному действию (S8.3) незачем.
   */
  nextLevel: GmLevel | null;
  /**
   * На сколько процентов должна упасть ЦЕНА ОТ СЕГОДНЯШНЕЙ, чтобы дойти
   * до `nextLevel`. Не разница уровней в п.п.: от −7% до −15% цене
   * остаётся упасть на 8,6%, а не на 8.
   */
  toNextPercent: number | null;
  /** Ориентир первой фиксации на росте (§6); null без точки отсчёта. */
  growth: {
    percent: number;
    priceUsd: number;
    reached: boolean | null;
    /** Отмечен отработанным; в журнале это уровень −50 (S8.1). */
    acted: boolean;
  } | null;
}

/**
 * Цена базового актива рынка — из длинной стороны пула: в паре BTC/USDC
 * длинная сторона и есть BTC, короткая всегда стейбл.
 *
 * Берётся из компонентов позиции, а не из цен CoinGecko: у GM это цена
 * оракула GMX, та самая, по которой пул и переоценивается. Ноль в стоимости
 * компонента означает «оракульной цены не было» (читатель не отличает его
 * от нуля), поэтому нулевая стоимость даёт null, а не цену.
 */
export function gmMarketPriceUsd(position: PositionDto): number | null {
  const long = position.components.find((c) => c.side === "long");
  if (!long || long.valueUsd === null) return null;
  if (long.quantity <= 0 || long.valueUsd <= 0) return null;
  return long.valueUsd / long.quantity;
}

/** Символ базового актива рынка: «WBTC» → цена именно его. */
export function gmMarketSymbol(position: PositionDto): string | null {
  return position.components.find((c) => c.side === "long")?.symbol ?? null;
}

/**
 * @param actedLevels уровни из журнала операций при текущей точке отсчёта.
 *   Не передан — считаем, что владелец не говорил ничего, и шкала отвечает
 *   одной лишь текущей ценой, как до Фазы 8.
 */
export function gmLevels(
  position: PositionDto,
  actedLevels?: GmActedLevels,
): GmLevelsView {
  const acted = new Set(actedLevels ?? []);
  const isActed = (level: number) => acted.has(level);
  const entryPriceUsd = position.entryPriceUsd;
  const currentPriceUsd = gmMarketPriceUsd(position);
  const marketSymbol = gmMarketSymbol(position);

  if (entryPriceUsd === null || entryPriceUsd <= 0) {
    return {
      entryPriceUsd: null,
      currentPriceUsd,
      marketSymbol,
      changePercent: null,
      levels: [],
      reachedCount: null,
      lastReached: null,
      nextLevel: null,
      toNextPercent: null,
      growth: null,
    };
  }

  const levels: GmLevel[] = GM_DROP_LEVELS.map((dropPercent) => {
    // Умножение на целую долю, а не на (1 − 0,7): у второго варианта
    // цена уровня −70% выходит 30 000,000000000004 и такой и печатается
    const priceUsd = (entryPriceUsd * (100 - dropPercent)) / 100;
    return {
      dropPercent,
      priceUsd,
      action: GM_ACTION[dropPercent],
      stabilityAction: STABILITY_ACTION[dropPercent],
      // Только про сегодняшнюю цену: где она стоит относительно уровня.
      // Действовал ли там владелец — соседнее поле `acted`, и одно
      // другому не замена (см. шапку модуля)
      reached: currentPriceUsd === null ? null : currentPriceUsd <= priceUsd,
      acted: isActed(dropPercent),
    };
  });

  const reached = levels.filter((l) => l.reached === true);
  // Отмеченные пропускаем независимо от цены: после отскока уровень
  // снова оказывается «впереди», но действие на нём уже сделано
  // S8.3 определяет следующий уровень только журналом: это первый уровень,
  // на котором владелец ещё не отметил операцию. Если цена уже ниже него,
  // действие не превращается в «пройденное» — оно как раз просрочено и
  // лента должна его показать. `reached` остаётся отдельным фактом рынка.
  const nextLevel = currentPriceUsd === null
    ? null
    : levels.find((l) => !l.acted) ?? null;
  const growthPriceUsd =
    (entryPriceUsd * (100 + GM_GROWTH_LEVEL_PERCENT)) / 100;

  return {
    entryPriceUsd,
    currentPriceUsd,
    marketSymbol,
    changePercent:
      currentPriceUsd === null
        ? null
        : (currentPriceUsd / entryPriceUsd - 1) * 100,
    levels,
    reachedCount: currentPriceUsd === null ? null : reached.length,
    lastReached: reached.at(-1) ?? null,
    nextLevel,
    toNextPercent:
      nextLevel === null || currentPriceUsd === null
        ? null
        // Уже ниже неотработанного уровня — ждать падения не нужно: до
        // действия осталось 0%, а не отрицательный процент.
        : Math.max(0, (1 - nextLevel.priceUsd / currentPriceUsd) * 100),
    growth: {
      percent: GM_GROWTH_LEVEL_PERCENT,
      priceUsd: growthPriceUsd,
      reached:
        currentPriceUsd === null ? null : currentPriceUsd >= growthPriceUsd,
      acted: isActed(GM_GROWTH_LEVEL_KEY),
    },
  };
}
