import type { StatusTone } from "@/components/dc/chip";
import { HF_OK_MARGIN } from "./hf";

/**
 * Арифметика риска ликвидации для экрана «Долг» (дизайн-код, README §6).
 *
 * Всё держится на одном свойстве Aave: health factor линеен по стоимости
 * залога при неизменном долге. HF = залог × порог_ликвидации / долг, значит
 * падение залога на d процентов умножает HF на (1 − d), и обратный вопрос
 * «на сколько может упасть залог» решается в одну строку.
 *
 * Это НЕ уровни стратегии −7 / −15 / −30 / −50 / −70
 * (docs/07-strategia-capital-growth.md §7): те считаются от подвижной точки
 * отсчёта по цене BTC и говорят, что делать с GM-пулами. Здесь — сценарии
 * падения текущего залога от «сейчас», и общего у них только знак минус.
 */

/** Ниже этого HF запас считается критическим — цвет loss (README §6). */
export const HF_CRITICAL = 1.2;

/** Границы зон полосы «Запас прочности» в процентах ширины (дизайн). */
export const SAFETY_LIQUIDATION_PERCENT = 22;
export const SAFETY_DANGER_PERCENT = 42;

/** Сценарии падения залога по умолчанию — доли, не проценты. */
export const DEFAULT_DROPS = [0.1, 0.2, 0.3];

/**
 * Цвет числа HF. Порог — граница «спокойно / тревожно», 1,2 — граница
 * «тревожно / критично»: между ней и ликвидацией остаётся меньше шестой
 * части стоимости залога.
 */
export function hfTone(
  healthFactor: number | null,
  threshold: number,
): StatusTone | null {
  if (healthFactor === null) return null; // долга нет — красить нечего
  if (healthFactor < HF_CRITICAL) return "loss";
  if (healthFactor < threshold) return "warn";
  return "profit";
}

/**
 * Насколько может упасть залог до HF = 1 (доля, 0…1).
 * null = долга нет или HF уже ниже единицы — запаса не осталось.
 */
export function liquidationDrop(healthFactor: number | null): number | null {
  if (healthFactor === null || healthFactor <= 1) return null;
  return 1 - 1 / healthFactor;
}

/** Падение залога, при котором HF опустится до `target` (доля, 0…1). */
export function dropToHf(
  healthFactor: number | null,
  target: number,
): number | null {
  if (healthFactor === null || healthFactor <= target) return null;
  return 1 - target / healthFactor;
}

export interface DropScenario {
  /** Падение стоимости залога — доля, 0…1. */
  drop: number;
  /** Стоимость залога после падения; null = залог неизвестен. */
  collateralUsd: number | null;
  healthFactor: number;
  tone: StatusTone;
  status: string;
  /** Точка, где HF = 1: строка-финал таблицы. */
  liquidation: boolean;
}

/** Статус сценария словами — цвет никогда не единственный признак. */
function scenarioStatus(
  healthFactor: number,
  threshold: number,
): { tone: StatusTone; status: string } {
  if (healthFactor <= 1) return { tone: "loss", status: "ликвидация" };
  if (healthFactor < HF_CRITICAL) return { tone: "loss", status: "критично" };
  if (healthFactor < threshold) return { tone: "warn", status: "ниже порога" };
  if (healthFactor < threshold + HF_OK_MARGIN)
    return { tone: "warn", status: "близко к порогу" };
  return { tone: "profit", status: "с запасом" };
}

/**
 * Таблица «Если залог упадёт»: заданные ступени падения плюс точка
 * ликвидации. Ступени за точкой ликвидации отбрасываются — показывать
 * HF 0,82 после того, как позиция уже закрыта принудительно, незачем.
 */
export function dropScenarios({
  healthFactor,
  collateralUsd,
  threshold,
  drops = DEFAULT_DROPS,
}: {
  healthFactor: number | null;
  collateralUsd: number | null;
  threshold: number;
  drops?: number[];
}): DropScenario[] {
  if (healthFactor === null) return [];
  const liq = liquidationDrop(healthFactor);
  const rows: DropScenario[] = [];

  const at = (drop: number, liquidation: boolean): DropScenario => {
    const hf = healthFactor * (1 - drop);
    return {
      drop,
      collateralUsd: collateralUsd === null ? null : collateralUsd * (1 - drop),
      healthFactor: hf,
      liquidation,
      ...scenarioStatus(hf, threshold),
    };
  };

  for (const drop of drops) {
    // Ступень, совпавшая с точкой ликвидации, дублировала бы её строку
    if (liq !== null && drop >= liq - 1e-9) continue;
    rows.push(at(drop, false));
  }
  if (liq !== null) rows.push(at(liq, true));
  return rows;
}

/**
 * Где стоит маркер «сейчас» на полосе запаса прочности.
 *
 * Шкала аффинная и привязана к двум точкам дизайна: HF = 1 приходится
 * на границу красной зоны (22%), HF = порог — на границу жёлтой (42%).
 * Отсюда свойство, ради которого это и сделано: маркер левее красной
 * границы тогда и только тогда, когда HF ниже единицы, и левее жёлтой —
 * когда HF ниже порога. Полоса не может противоречить числу.
 */
export function safetyPosition(healthFactor: number, threshold: number): number {
  const span = threshold > 1 ? threshold - 1 : 0.5;
  const slope =
    (SAFETY_DANGER_PERCENT - SAFETY_LIQUIDATION_PERCENT) / span;
  const percent =
    SAFETY_LIQUIDATION_PERCENT + slope * (healthFactor - 1);
  return Math.min(100, Math.max(0, percent));
}

/**
 * Порог ликвидации по LTV, восстановленный из HF: сам Aave отдаёт его
 * только по резервам, а в кэше экрана лежат агрегаты. Из HF = залог × LT /
 * долг следует залог_i × LT_i = HF_i × долг_i, поэтому взвешенный по залогу
 * порог — это сумма HF × долг, делённая на сумму залога.
 *
 * Возвращает проценты; null, если хоть одно слагаемое неизвестно.
 */
export function liquidationLtvPercent(
  chains: {
    totalCollateralUsd: number | null;
    totalDebtUsd: number | null;
    healthFactor: number | null;
  }[],
): number | null {
  let weighted = 0;
  let collateral = 0;
  for (const c of chains) {
    if (c.totalCollateralUsd === null) return null;
    collateral += c.totalCollateralUsd;
    if (c.healthFactor === null) continue; // сеть без долга порог не задаёт
    if (c.totalDebtUsd === null) return null;
    weighted += c.healthFactor * c.totalDebtUsd;
  }
  if (collateral <= 0 || weighted <= 0) return null;
  return (weighted / collateral) * 100;
}

/** Что нужно сделать с долгом, чтобы LTV встал на цель. */
export interface LtvRebalance {
  /** Каким станет долг на целевом LTV. */
  targetDebtUsd: number;
  /** Долг минус целевой: >0 — взять ещё, <0 — погасить. */
  deltaUsd: number;
  action: "borrow" | "repay" | "on-target";
}

/**
 * Выравнивание плеча к целевому LTV (docs/07 §10.3, «Целевой LTV 50%»).
 *
 *   LTV = долг / залог,  целевой долг = цель × залог
 *
 * Залог считается неизменным: и погашение, и добор долга его не трогают —
 * заёмные приходят стейблами, а они в залог не попадают. Поэтому выровнять
 * LTV можно только долгом, и это ровно одно число.
 *
 * `on-target` отдаётся при расхождении меньше цента: копеечная разница —
 * это дрожание цен между чтениями, а не задача к действию.
 *
 * null = нечего считать: без залога LTV не определён.
 */
export function ltvRebalance(
  collateralUsd: number | null,
  debtUsd: number | null,
  targetLtvPct: number,
): LtvRebalance | null {
  if (collateralUsd === null || debtUsd === null) return null;
  if (collateralUsd <= 0) return null;

  const targetDebtUsd = (targetLtvPct / 100) * collateralUsd;
  const deltaUsd = targetDebtUsd - debtUsd;
  const action =
    Math.abs(deltaUsd) < 0.01 ? "on-target" : deltaUsd > 0 ? "borrow" : "repay";

  return { targetDebtUsd, deltaUsd, action };
}
