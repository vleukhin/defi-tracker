import type {
  FundsMark,
  PortfolioCategory,
  PositionProtocol,
  StrategyZone,
  ZoneBreakdownDto,
  ZonesSummaryDto,
} from "@/lib/api/types";

/**
 * Зоны стратегии Capital Growth (docs/07-strategia-capital-growth.md) —
 * чистая функция без I/O.
 *
 * Зоны — не переименование трех категорий, а другой разрез. Категория
 * отвечает «в чем лежит» (BTC / ETH / стейблы), зона — «какую задачу решает»
 * (растим капитал / зарабатываем / страхуем просадку). Стейблкоины есть и в
 * Stability, и в Yield, поэтому одно через другое не выражается.
 *
 * СЧИТАЕМ ПО АТОМАМ, А НЕ ПО КАТЕГОРИЯМ. Каждая единица стоимости попадает
 * ровно в одну зону:
 *
 *   залог BTC/ETH     -> Growth всегда (это заложенные базовые активы);
 *   свободные стейблы -> своя зона, при отсутствии разметки — по категории;
 *   читаемая позиция  -> своя зона ЦЕЛИКОМ, по умолчанию Yield.
 *
 * Отсюда инвариант, который держится тестом:
 *
 *   Growth + Yield + Stability = залог + позиции + свободные = Активы
 *
 * Вычитать здесь нечего, и это главное отличие от разреза по категориям.
 * Собственные стейблы внутри позиции в зонах отдельной строкой не возникают:
 * позиция уже учтена полностью. В категориях наоборот — там своя доля живет
 * в «Стейблах», и потому «Активы» считаются с вычетом (см. positions.ts).
 */

export const ZONES: StrategyZone[] = ["growth", "yield", "stability"];

export const ZONE_LABEL: Record<StrategyZone, string> = {
  growth: "Growth",
  yield: "Yield",
  stability: "Stability",
};

export const ZONE_PURPOSE: Record<StrategyZone, string> = {
  growth: "Растим количество BTC и ETH; активы зоны не продаем",
  yield: "Зарабатываем на заемных и собственных средствах",
  stability: "Страхуем просадку и держим Health Factor",
};

/**
 * Зона ручной записи, когда разметки нет.
 * Стейблы — Stability (по стратегии зона состоит из них), BTC/ETH — Growth.
 */
export function defaultZoneForCategory(
  category: PortfolioCategory,
): StrategyZone {
  return category === "stable" ? "stability" : "growth";
}

/**
 * Зона позиции по умолчанию — Yield: по стратегии читаемые позиции
 * открываются на заемные средства и служат генерации дохода. Стейблкоин-
 * стратегии Stability (Pendle PT, пулы USDC/USDT) размечаются вручную.
 */
export const DEFAULT_POSITION_ZONE: StrategyZone = "yield";

export interface CollateralAtom {
  category: PortfolioCategory;
  valueUsd: number;
}

export interface ManualAtom {
  id: string;
  category: PortfolioCategory;
  label: string;
  valueUsd: number;
  /** null = не размечено, зона выводится из категории. */
  zone: StrategyZone | null;
}

/**
 * Свободные средства на кошельке — атом, которого до Фазы 7 не было:
 * деньги, лежащие на адресе и не участвующие ни в залоге, ни в позициях.
 */
export interface FreeAtom {
  /** `${walletId}:${chain}:${token}`. */
  id: string;
  category: PortfolioCategory;
  symbol: string;
  valueUsd: number;
  /** null = не размечено. */
  funds: FundsMark | null;
}

export interface PositionAtom {
  id: string;
  protocol: PositionProtocol;
  title: string;
  /** null = стоимость неизвестна: зона не сможет отдать сумму. */
  valueUsd: number | null;
  zone: StrategyZone;
  /** Собственная доля; null = не размечено (в расчете считается нулем). */
  ownUsd: number | null;
}

export interface BuildZonesInput {
  collateral: CollateralAtom[];
  /** Только свободные стейблы: доли внутри позиций сюда не попадают. */
  manual: ManualAtom[];
  positions: PositionAtom[];
  /**
   * Свободные средства кошельков. Необязательное: без него результат
   * обязан совпадать с доФазой 7 до последней цифры.
   */
  free?: FreeAtom[];
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

export function zoneOfManual(entry: ManualAtom): StrategyZone {
  return entry.zone ?? defaultZoneForCategory(entry.category);
}

/**
 * Зона свободных средств.
 *
 * Заемные — всегда Yield: по стратегии (docs/07 §1-2) заем берется под залог
 * Growth и направляется в зону доходности. Деньги, уже занятые, но еще
 * не размещенные, задачу свою не сменили — они в пути, а не в резерве.
 * Класть их в Stability значило бы показать заемный резерв страховкой
 * просадки, тогда как Stability по стратегии состоит из СОБСТВЕННЫХ денег.
 *
 * Свои и неразмеченные — по категории, как ручные записи: стейблы страхуют
 * просадку (Stability), BTC и ETH растут вместе с рынком (Growth).
 */
export function zoneOfFree(atom: FreeAtom): StrategyZone {
  return atom.funds === "borrowed"
    ? "yield"
    : defaultZoneForCategory(atom.category);
}

export function buildZones(input: BuildZonesInput): ZonesSummaryDto {
  const parts: Record<
    StrategyZone,
    {
      collateralUsd: number;
      manualUsd: number;
      freeUsd: number;
      positionsUsd: (number | null)[];
    }
  > = {
    growth: { collateralUsd: 0, manualUsd: 0, freeUsd: 0, positionsUsd: [] },
    yield: { collateralUsd: 0, manualUsd: 0, freeUsd: 0, positionsUsd: [] },
    stability: { collateralUsd: 0, manualUsd: 0, freeUsd: 0, positionsUsd: [] },
  };

  // Залог — всегда Growth: это заложенные базовые активы, ради роста
  // количества которых стратегия и существует
  for (const c of input.collateral) {
    parts.growth.collateralUsd += c.valueUsd;
  }

  for (const m of input.manual) {
    parts[zoneOfManual(m)].manualUsd += m.valueUsd;
  }

  // Свободные средства входят ЦЕЛИКОМ, включая заемные: в разрезе по зонам
  // ничего не вычитается, иначе сумма зон разошлась бы с «Активами»
  for (const f of input.free ?? []) {
    parts[zoneOfFree(f)].freeUsd += f.valueUsd;
  }

  for (const p of input.positions) {
    parts[p.zone].positionsUsd.push(p.valueUsd);
  }

  const zones: Omit<ZoneBreakdownDto, "percent">[] = ZONES.map((zone) => {
    const part = parts[zone];
    const positionsUsd = sumOrNull(part.positionsUsd);
    const base = part.collateralUsd + part.manualUsd + part.freeUsd;
    return {
      zone,
      label: ZONE_LABEL[zone],
      purpose: ZONE_PURPOSE[zone],
      collateralUsd: part.collateralUsd,
      manualUsd: part.manualUsd,
      freeUsd: part.freeUsd,
      positionsUsd,
      valueUsd: positionsUsd === null ? null : base + positionsUsd,
      positionCount: part.positionsUsd.length,
    };
  });

  const totalUsd = sumOrNull(zones.map((z) => z.valueUsd));

  return {
    zones: zones.map((z) => ({
      ...z,
      // Доля считается только когда известен весь знаменатель: иначе
      // проценты не сложились бы в 100 и вводили бы в заблуждение
      percent:
        totalUsd === null || totalUsd === 0 || z.valueUsd === null
          ? null
          : (z.valueUsd / totalUsd) * 100,
    })),
    totalUsd,
    // Неразмеченная позиция считается целиком заемной, но ее видно отдельно
    ownInPositionsUsd: input.positions.reduce((s, p) => s + (p.ownUsd ?? 0), 0),
    // Свободные: неразмеченные идут к своим (в отличие от позиций), но их
    // число выводится рядом — умолчание не должно быть молчаливым
    freeOwnUsd: (input.free ?? []).reduce(
      (s, f) => s + (f.funds === "borrowed" ? 0 : f.valueUsd),
      0,
    ),
    freeBorrowedUsd: (input.free ?? []).reduce(
      (s, f) => s + (f.funds === "borrowed" ? f.valueUsd : 0),
      0,
    ),
    unmarkedFree: (input.free ?? []).filter((f) => f.funds === null).length,
    unpricedPositions: input.positions.filter((p) => p.valueUsd === null).length,
    unmarkedPositions: input.positions.filter((p) => p.ownUsd === null).length,
  };
}
