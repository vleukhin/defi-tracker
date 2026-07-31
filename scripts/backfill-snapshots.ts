/**
 * Восстановление истории снепшотов по журналу сделок и рыночным ценам:
 *   npm run backfill -- --from 2026-01-01 [--apply] [--replace] [--stable N]
 *
 * Что реконструируется и откуда:
 *   * количество BTC и ETH на каждую дату — реплеем журнала сделок
 *     (покупка прибавляет, продажа вычитает);
 *   * цена на каждую дату — CoinGecko /market_chart/range, реальные
 *     дневные котировки, ничего не интерполируется;
 *   * стейблкоины — ДОПУЩЕНИЕ по решению пользователя: принимаются
 *     неизменными на всем периоде и равными текущей сумме ручных записей
 *     (переопределяется флагом --stable). Истории ручных записей не
 *     существует, поэтому это единственная величина здесь, которая не
 *     опирается на данные. Без нее на стыке с первым измерением возникала
 *     ступенька в размере стейблов, читавшаяся как скачок доходности.
 *
 * Долг и health factor не восстанавливаются вовсе: позиции Aave задним
 * числом не прочитать. Точки пишутся как обычные (is_partial = false) —
 * по решению пользователя маркер частичных данных на графике не нужен;
 * сам механизм пометки остается рабочим для настоящих неполных снепшотов.
 *
 * Безопасность:
 *   * без --apply только показывает план (dry-run по умолчанию);
 *   * даты, где снепшот уже есть, пропускаются (--replace перезапишет);
 *   * сегодняшний день не трогается никогда — там настоящее измерение.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertRemoteIfRequired, normalizeSupabaseUrl } from "./env-guard.ts";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Ошибка: переменная окружения ${name} не задана`);
    process.exit(1);
  }
  return value;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const url = normalizeSupabaseUrl(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"));
const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
assertRemoteIfRequired(url);

const apply = process.argv.includes("--apply");
const replace = process.argv.includes("--replace");
const from = arg("--from") ?? "2026-01-01";
const stableOverride = arg("--stable");
const email = arg("--email") ?? process.env.ADMIN_EMAIL;
if (!email) {
  console.error("Укажите --email или задайте ADMIN_EMAIL");
  process.exit(1);
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const COINGECKO_IDS = { btc: "bitcoin", eth: "ethereum" } as const;
type Cat = keyof typeof COINGECKO_IDS;

/** YYYY-MM-DD в UTC. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function eachDay(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${fromDay}T00:00:00Z`);
  const end = new Date(`${toDay}T00:00:00Z`);
  while (cur <= end) {
    out.push(isoDay(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

async function findUserId(target: string): Promise<string> {
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) throw new Error(`listUsers: ${error.message}`);
  const found = data.users.find(
    (u) => u.email?.toLowerCase() === target.toLowerCase(),
  );
  if (!found) throw new Error(`Пользователь ${target} не найден`);
  return found.id;
}

/** Дневные цены категории: карта «дата -> цена». */
async function fetchPrices(
  id: string,
  fromDay: string,
  toDay: string,
): Promise<Map<string, number>> {
  const fromTs = Math.floor(Date.parse(`${fromDay}T00:00:00Z`) / 1000);
  // Запас в сутки, чтобы последняя дата точно попала в диапазон
  const toTs = Math.floor(Date.parse(`${toDay}T00:00:00Z`) / 1000) + 86_400;
  const u = new URL(`https://api.coingecko.com/api/v3/coins/${id}/market_chart/range`);
  u.searchParams.set("vs_currency", "usd");
  u.searchParams.set("from", String(fromTs));
  u.searchParams.set("to", String(toTs));

  const apiKey = process.env.COINGECKO_API_KEY;
  const res = await fetch(u, {
    headers: apiKey ? { "x-cg-demo-api-key": apiKey } : {},
  });
  if (!res.ok) throw new Error(`CoinGecko ${id}: HTTP ${res.status}`);
  const body = (await res.json()) as { prices?: [number, number][] };
  if (!body.prices) throw new Error(`CoinGecko ${id}: нет поля prices`);

  const map = new Map<string, number>();
  for (const [ts, price] of body.prices) {
    // При нескольких точках за сутки берется последняя — конец дня
    map.set(isoDay(new Date(ts)), price);
  }
  return map;
}

async function main() {
  const userId = await findUserId(email!);
  const today = isoDay(new Date());

  // --- Журнал сделок ---
  const { data: tradeRows, error: tradesError } = await admin
    .from("trades")
    .select("category, side, quantity, traded_at")
    .eq("user_id", userId)
    .order("traded_at", { ascending: true });
  if (tradesError) throw new Error(`trades: ${tradesError.message}`);
  const trades = tradeRows ?? [];
  if (trades.length === 0) {
    console.error("Журнал сделок пуст — восстанавливать нечего");
    process.exit(1);
  }

  // Стейблы: допущение «неизменны на всем периоде». Берем текущую сумму
  // ручных записей, если не задано явно флагом.
  let stableUsd = stableOverride === null ? 0 : Number(stableOverride);
  if (stableOverride === null) {
    const { data: manualRows, error: manualError } = await admin
      .from("manual_positions")
      .select("amount")
      .eq("user_id", userId)
      .eq("category", "stable");
    if (manualError) throw new Error(`manual_positions: ${manualError.message}`);
    stableUsd = (manualRows ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
  }

  const lastTradeDay = String(trades[trades.length - 1].traded_at).slice(0, 10);
  // Верхняя граница — вчера: сегодняшняя точка снимается по-настоящему
  const yesterday = isoDay(new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000));
  const to = yesterday;

  console.log(`База:     ${url}`);
  console.log(`Владелец: ${email}`);
  console.log(`Сделок:   ${trades.length} (последняя ${lastTradeDay})`);
  console.log(`Период:   ${from} … ${to}${apply ? "" : "   [dry-run]"}`);
  console.log(
    `Стейблы:  $${stableUsd.toFixed(0)} — ДОПУЩЕНИЕ: приняты неизменными на всем периоде\n`,
  );

  // --- Цены ---
  const prices: Record<Cat, Map<string, number>> = {
    btc: await fetchPrices(COINGECKO_IDS.btc, from, to),
    eth: await fetchPrices(COINGECKO_IDS.eth, from, to),
  };
  console.log(
    `Цены: BTC ${prices.btc.size} дней, ETH ${prices.eth.size} дней\n`,
  );

  // --- Уже существующие снепшоты ---
  // Измеренные точки (снятые с реального залога) НЕ перезаписываются никогда,
  // даже с --replace: реконструкция поверх измерения — потеря данных, которую
  // нечем откатить. Признак измерения — непустой состав залога.
  const { data: existingRows, error: existingError } = await admin
    .from("snapshots")
    .select("taken_on, snapshot_items (composition)")
    .eq("user_id", userId);
  if (existingError) throw new Error(`snapshots: ${existingError.message}`);

  const existing = new Set<string>();
  const measured = new Set<string>();
  for (const row of existingRows ?? []) {
    const day = String((row as { taken_on: string }).taken_on);
    existing.add(day);
    const items =
      (row as { snapshot_items?: { composition?: { collateral?: unknown[] } | null }[] })
        .snapshot_items ?? [];
    if (items.some((it) => (it.composition?.collateral?.length ?? 0) > 0)) {
      measured.add(day);
    }
  }

  // --- Реплей журнала по дням ---
  const days = eachDay(from, to);
  let ti = 0;
  const qty: Record<Cat, number> = { btc: 0, eth: 0 };
  // Сделки до начала периода формируют стартовый остаток
  const startTs = Date.parse(`${from}T00:00:00Z`);
  while (
    ti < trades.length &&
    Date.parse(String(trades[ti].traded_at)) < startTs
  ) {
    const t = trades[ti];
    const cat = t.category as Cat;
    if (cat === "btc" || cat === "eth") {
      qty[cat] += (t.side === "buy" ? 1 : -1) * Number(t.quantity);
    }
    ti += 1;
  }
  console.log(
    `Остаток на ${from}: BTC ${qty.btc.toFixed(4)}, ETH ${qty.eth.toFixed(4)}\n`,
  );

  let planned = 0;
  let skipped = 0;
  let protectedDays = 0;
  let noPrice = 0;
  const preview: string[] = [];

  for (const day of days) {
    // Доигрываем сделки этого дня (включительно)
    const dayEnd = Date.parse(`${day}T23:59:59.999Z`);
    while (ti < trades.length && Date.parse(String(trades[ti].traded_at)) <= dayEnd) {
      const t = trades[ti];
      const cat = t.category as Cat;
      if (cat === "btc" || cat === "eth") {
        qty[cat] += (t.side === "buy" ? 1 : -1) * Number(t.quantity);
      }
      ti += 1;
    }

    if (measured.has(day)) {
      // Измерение важнее реконструкции — пропускаем даже с --replace
      protectedDays += 1;
      continue;
    }
    if (existing.has(day) && !replace) {
      skipped += 1;
      continue;
    }

    const pBtc = prices.btc.get(day);
    const pEth = prices.eth.get(day);
    if (pBtc === undefined || pEth === undefined) {
      noPrice += 1;
      continue;
    }

    const valueBtc = qty.btc * pBtc;
    const valueEth = qty.eth * pEth;
    const total = valueBtc + valueEth + stableUsd;
    planned += 1;

    if (preview.length < 3 || day === days[days.length - 1]) {
      preview.push(
        `  ${day}  BTC ${qty.btc.toFixed(4)} × $${pBtc.toFixed(0)} = $${valueBtc.toFixed(0)}` +
          `   ETH ${qty.eth.toFixed(4)} × $${pEth.toFixed(0)} = $${valueEth.toFixed(0)}` +
          `   стейблы $${stableUsd.toFixed(0)}   итого $${total.toFixed(0)}`,
      );
    }

    if (!apply) continue;

    const { data: snapRow, error: snapError } = await admin
      .from("snapshots")
      .upsert(
        {
          user_id: userId,
          taken_on: day,
          taken_at: `${day}T00:00:00.000Z`,
          total_usd: total,
          // Обычная точка: маркер частичных данных на графике не нужен
          // (решение пользователя). Механизм пометки продолжает работать
          // для настоящих неполных снепшотов — упавших сетей и старых цен.
          is_partial: false,
        },
        { onConflict: "user_id,taken_on" },
      )
      .select("id")
      .single();
    if (snapError) throw new Error(`${day} snapshots: ${snapError.message}`);

    const snapshotId = (snapRow as { id: string }).id;
    const items = [
      { category: "btc", quantity: qty.btc, price: pBtc, value: valueBtc, manual: 0 },
      { category: "eth", quantity: qty.eth, price: pEth, value: valueEth, manual: 0 },
      // Стейблы: цена $1, количество равно сумме — как в настоящих снепшотах
      { category: "stable", quantity: stableUsd, price: 1, value: stableUsd, manual: stableUsd },
    ].map((it) => ({
      snapshot_id: snapshotId,
      category: it.category,
      quantity: it.quantity,
      price_usd: it.price,
      value_usd: it.value,
      percent: total > 0 ? (it.value / total) * 100 : 0,
      // Источник BTC/ETH — журнал сделок, а не залог; стейблы — ручная сумма
      collateral_usd: 0,
      manual_usd: it.manual,
    }));
    const { error: itemsError } = await admin
      .from("snapshot_items")
      .upsert(items, { onConflict: "snapshot_id,category" });
    if (itemsError) throw new Error(`${day} snapshot_items: ${itemsError.message}`);
  }

  console.log("Пример точек:");
  for (const line of preview) console.log(line);
  console.log();
  console.log(`К записи:  ${planned}`);
  if (skipped) console.log(`Пропущено: ${skipped} (снепшот уже есть; --replace перезапишет)`);
  if (protectedDays)
    console.log(`Защищено:  ${protectedDays} (настоящее измерение — не перезаписывается)`);
  if (noPrice) console.log(`Без цены:  ${noPrice} (день не покрыт котировками — точка не создается)`);

  if (!apply) {
    console.log("\nЭто предпросмотр. Для записи добавьте --apply");
  } else {
    console.log("\nГотово. Точки записаны как обычные снепшоты.");
    console.log(`BTC и ETH — по журналу сделок и рыночным ценам; стейблы \$${stableUsd.toFixed(0)}`);
    console.log("приняты неизменными (допущение); долг за прошлые даты не восстановлен.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
