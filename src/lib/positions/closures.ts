import type {
  ClosedPositionDto,
  PositionProtocol,
  StrategyZone,
} from "@/lib/api/types";
import {
  buildPositions,
  splitPosition,
  zoneKeyOf,
  type PositionMark,
  type PositionRowInput,
} from "./positions";
import { POSITION_SOURCES, PROTOCOL_LABELS } from "./sources";
import { DEFAULT_POSITION_ZONE, defaultZoneForPendle } from "./zones";

/**
 * Закрытые позиции: что сохранить в момент исчезновения и как собрать архив.
 * Чистый слой без I/O — запросы живут в lib/chains/closures.ts.
 *
 * ПОЧЕМУ ЗАПИСЬ, А НЕ ВЫВОД ИЗ ОТСУТСТВИЯ. Читатели цепочек удаляют строки
 * позиций, которых больше нет в ответе сети, и выбрасывают их. Последняя
 * стоимость, состав LP и цена оракула GM на тот момент после этого
 * невосстановимы ни из какого источника — тот же довод, по которому снепшот
 * хранит positions_usd (20260731000100). Вывести «закрыта» из отсутствия
 * тоже нельзя: отсутствие одинаково выглядит у вышедшей позиции, у
 * недельного отказа RPC и у удалённого кошелька.
 *
 * ПОЧЕМУ СТОИМОСТЬ СЧИТАЕТСЯ ЗДЕСЬ, А НЕ БЕРЁТСЯ ИЗ value_usd.
 * protocol_positions.value_usd заполнен только у GM-пулов: их цену отдаёт
 * оракул GMX. У Fluid, CLMM и Pendle стоимость считается при показе из
 * payload и цены актива, а в кэше лежит null. Поэтому закрытие прогоняет
 * обречённые строки через тот же buildPositions, что и живой экран: в архив
 * ложится ровно то число, которое экран показывал последним, а не вторая
 * реализация формулы.
 *
 * ПОЧЕМУ РАЗМЕТКА КОПИРУЕТСЯ. position_marks живёт по натуральному ключу, а
 * Fluid, Pendle и GMX при повторном входе в тот же рынок переиспользуют его.
 * Ссылка показала бы у закрытой позиции вложенное от следующего цикла.
 *
 * ИТОГ — ОЦЕНКА, А НЕ ФАКТ. Формула одна на весь проект (splitPosition):
 * стоимость + выведено − вложено. В стоимость подставлено последнее
 * показание, потому что фактической выручки приложение не знает. Выдавать
 * его за выручку нельзя, и об этом говорит интерфейс.
 */

/** Строка protocol_positions, которую сейчас удалит читатель. */
export interface VanishedRow {
  id: string;
  protocol: string;
  chain: string;
  external_id: string;
  quantity: string | number | null;
  value_usd: string | number | null;
  payload: unknown;
  /** Момент последнего успешного чтения — он же ключ идемпотентности. */
  updated_at: string;
}

/** Строка снимка разметки, как она лежит в position_marks. */
export interface MarkRow {
  external_id: string;
  zone: string | null;
  own_principal_usd: string | number | null;
  borrowed_principal_usd: string | number | null;
  withdrawn_usd: string | number | null;
  entry_price_usd: string | number | null;
}

/** Запись closed_positions — ровно то, что уходит во вставку. */
export interface ClosureRow {
  user_id: string;
  wallet_id: string;
  protocol: string;
  chain: string;
  external_id: string;
  title: string;
  subtitle: string | null;
  last_value_usd: number | null;
  last_quantity: number | null;
  payload: unknown;
  last_read_at: string;
  closed_at: string;
  zone: string | null;
  own_principal_usd: number | null;
  borrowed_principal_usd: number | null;
  withdrawn_usd: number | null;
  entry_price_usd: number | null;
}

/**
 * Колонки конфликта: они же — определение «того же самого закрытия».
 * Повторный вход в тот же рынок приходит с другим updated_at и ложится
 * отдельной строкой, повтор того же закрытия сталкивается сам с собой.
 */
export const CLOSURE_CONFLICT =
  "user_id,protocol,chain,external_id,last_read_at";

/** Колонки архива для выборки. payload наружу не отдаётся — он для подписи. */
export const CLOSURE_COLUMNS =
  "id, protocol, chain, external_id, title, subtitle, last_value_usd, " +
  "last_quantity, payload, last_read_at, closed_at, zone, own_principal_usd, " +
  "borrowed_principal_usd, withdrawn_usd, entry_price_usd, wallet_id";

/** numeric приходит из PostgREST строкой; null остаётся null, а не нулём. */
function numOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Протокол размещения или null, если в строке что-то постороннее. */
function protocolOf(value: string): PositionProtocol | null {
  return (POSITION_SOURCES as readonly string[]).includes(value)
    ? (value as PositionProtocol)
    : null;
}

/** Разметка позиции из строки снимка. Зона здесь не нужна: её везут отдельно. */
function markOf(row: MarkRow | undefined): PositionMark {
  return {
    zone: null,
    ownPrincipalUsd: numOrNull(row?.own_principal_usd),
    borrowedPrincipalUsd: numOrNull(row?.borrowed_principal_usd),
    withdrawnUsd: numOrNull(row?.withdrawn_usd),
    entryPriceUsd: numOrNull(row?.entry_price_usd),
  };
}

/** Обречённые строки в виде входа для buildPositions. */
export function vanishedAsPositionRows(
  rows: VanishedRow[],
  walletId: string,
): PositionRowInput[] {
  return rows.map((row) => ({
    id: row.id,
    protocol: row.protocol,
    chain: row.chain,
    externalId: row.external_id,
    quantity: row.quantity === null ? null : String(row.quantity),
    valueUsd: numOrNull(row.value_usd),
    payload: row.payload,
    updatedAt: row.updated_at,
    walletId,
    walletLabel: null,
  }));
}

export interface BuildClosureRowsInput {
  userId: string;
  walletId: string;
  rows: VanishedRow[];
  /** Разметка по external_id — ровно по закрываемым позициям. */
  marks: MarkRow[];
  /** Цены по coingecko id (только кэш). */
  pricesUsd: Map<string, number>;
  closedAt: string;
}

/**
 * Записи закрытия из обречённых строк, их разметки и цен.
 *
 * Стоимость и подпись берутся у buildPositions — той же сборки, что у живого
 * экрана. Зона, вложенное и выведенное берутся из РАЗМЕТКИ, а не из DTO:
 * в DTO зона уже подставлена умолчанием, а в архив нужно именно
 * «не размечено», иначе решение владельца станет неотличимо от решения
 * приложения.
 *
 * Строка с неразобранным payload buildPositions молча пропускает (там это
 * верно: показывать нечего). Для архива это недопустимо — нераспознанный
 * payload причина потерять описание, а не причина потерять запись, поэтому
 * такие строки получают подпись-заглушку и стоимость из value_usd как есть.
 */
export function buildClosureRows(
  input: BuildClosureRowsInput,
): ClosureRow[] {
  const { userId, walletId, rows, pricesUsd, closedAt } = input;
  const markByExternalId = new Map(input.marks.map((m) => [m.external_id, m]));

  const marksByKey = new Map<string, PositionMark>();
  for (const row of rows) {
    const key = zoneKeyOf({
      protocol: row.protocol,
      chain: row.chain,
      externalId: row.external_id,
    });
    marksByKey.set(key, markOf(markByExternalId.get(row.external_id)));
  }

  const { positions } = buildPositions({
    rows: vanishedAsPositionRows(rows, walletId),
    pricesUsd,
    marksByKey,
  });
  const dtoById = new Map(positions.map((p) => [p.id, p]));

  return rows.map((row) => {
    const dto = dtoById.get(row.id);
    const protocol = protocolOf(row.protocol);
    const fallback =
      protocol === null
        ? { title: row.protocol, subtitle: shortId(row.external_id) }
        : closureTitleOf(protocol, row.external_id);
    const mark = markByExternalId.get(row.external_id);

    return {
      user_id: userId,
      wallet_id: walletId,
      protocol: row.protocol,
      chain: row.chain,
      external_id: row.external_id,
      title: dto?.title ?? fallback.title,
      subtitle: dto?.subtitle ?? fallback.subtitle,
      last_value_usd: dto ? dto.valueUsd : numOrNull(row.value_usd),
      last_quantity: numOrNull(row.quantity),
      payload: row.payload ?? null,
      // Момент ЧТЕНИЯ, а не «сейчас»: стоимость верна на эту дату, и она же
      // отличает повтор того же закрытия от повторного входа в рынок
      last_read_at: row.updated_at,
      closed_at: closedAt,
      zone: mark?.zone ?? null,
      own_principal_usd: numOrNull(mark?.own_principal_usd),
      borrowed_principal_usd: numOrNull(mark?.borrowed_principal_usd),
      withdrawn_usd: numOrNull(mark?.withdrawn_usd),
      entry_price_usd: numOrNull(mark?.entry_price_usd),
    };
  });
}

/**
 * Подпись-заглушка, когда payload не разобрался. Имя протокола и усечённый
 * external_id отвечают хотя бы на вопрос «где это было» — пустая подпись
 * не отвечает ни на один.
 */
export function closureTitleOf(
  protocol: PositionProtocol,
  externalId: string,
): { title: string; subtitle: string | null } {
  return { title: PROTOCOL_LABELS[protocol], subtitle: shortId(externalId) };
}

/** Адрес или tokenId в читаемой длине: подпись, а не ссылка. */
function shortId(externalId: string): string {
  return externalId.length > 14
    ? `${externalId.slice(0, 8)}…${externalId.slice(-4)}`
    : externalId;
}

/**
 * Зона архивной записи: снимок разметки, а при его отсутствии — умолчание
 * протокола. Умолчание не записывалось в базу намеренно, иначе «так решил
 * владелец» стало бы неотличимо от «так решило приложение».
 */
function zoneOf(
  protocol: PositionProtocol,
  payload: unknown,
  marked: string | null,
): { zone: StrategyZone; assumed: boolean } {
  if (marked === "growth" || marked === "yield" || marked === "stability") {
    return { zone: marked, assumed: false };
  }
  if (protocol === "pendle") {
    const tokenType = (payload as { tokenType?: unknown } | null)?.tokenType;
    if (tokenType === "pt" || tokenType === "yt" || tokenType === "lp") {
      return { zone: defaultZoneForPendle(tokenType), assumed: true };
    }
  }
  return { zone: DEFAULT_POSITION_ZONE, assumed: true };
}

/** Строка closed_positions с подписью кошелька, как её отдаёт роут. */
export interface ClosureReadRow {
  id: string;
  protocol: string;
  chain: string;
  external_id: string;
  title: string;
  subtitle: string | null;
  last_value_usd: string | number | null;
  last_quantity: string | number | null;
  payload: unknown;
  last_read_at: string;
  closed_at: string;
  zone: string | null;
  own_principal_usd: string | number | null;
  borrowed_principal_usd: string | number | null;
  withdrawn_usd: string | number | null;
  entry_price_usd: string | number | null;
  wallet_id: string;
  walletLabel?: string | null;
}

/**
 * Сборка архива. Итог считается существующим splitPosition: формула
 * «стоимость + выведено − вложено» в проекте одна, и расходиться ей негде.
 * ownCurrentUsd оттуда НЕ берётся: текущей собственной доли у закрытой
 * позиции не существует.
 */
export function buildClosedPositions(
  rows: ClosureReadRow[],
): ClosedPositionDto[] {
  const out: ClosedPositionDto[] = [];
  for (const row of rows) {
    const protocol = protocolOf(row.protocol);
    // Посторонний протокол в архиве — рассогласование схемы, а не данные
    // владельца: показывать его как позицию нельзя
    if (protocol === null) continue;

    const lastValueUsd = numOrNull(row.last_value_usd);
    const mark = markOf({
      external_id: row.external_id,
      zone: row.zone,
      own_principal_usd: row.own_principal_usd,
      borrowed_principal_usd: row.borrowed_principal_usd,
      withdrawn_usd: row.withdrawn_usd,
      entry_price_usd: row.entry_price_usd,
    });
    const { profitUsd, profitPct } = splitPosition(lastValueUsd, mark);
    const { zone, assumed } = zoneOf(protocol, row.payload, row.zone);

    out.push({
      id: row.id,
      protocol,
      protocolLabel: PROTOCOL_LABELS[protocol],
      chain: row.chain,
      zoneKey: zoneKeyOf({
        protocol: row.protocol,
        chain: row.chain,
        externalId: row.external_id,
      }),
      zone,
      zoneAssumed: assumed,
      title: row.title,
      subtitle: row.subtitle,
      lastValueUsd,
      lastQuantity:
        row.last_quantity === null ? null : String(row.last_quantity),
      ownPrincipalUsd: mark.ownPrincipalUsd,
      borrowedPrincipalUsd: mark.borrowedPrincipalUsd,
      withdrawnUsd: mark.withdrawnUsd,
      entryPriceUsd: mark.entryPriceUsd,
      profitUsd,
      profitPct,
      lastReadAt: row.last_read_at,
      closedAt: row.closed_at,
      walletId: row.wallet_id,
      walletLabel: row.walletLabel ?? null,
    });
  }
  return out;
}
