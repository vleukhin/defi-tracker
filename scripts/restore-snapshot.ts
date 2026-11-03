/**
 * Восстановление пропущенной точки истории ИЗМЕРЕНИЕМ, а не моделью:
 *   npm run restore -- --date 2026-10-26 [--at 03:00] [--apply] [--replace]
 *
 * Чем отличается от `npm run backfill`. Бэкфилл реконструирует портфель как
 * «BTC + ETH по журналу сделок плюс неизменные стейблы» — модель, которая
 * не видит ни залога Aave, ни долга, ни Pendle, ни GM-пулов, ни LP. Этот
 * скрипт ничего не моделирует: он читает ТЕ ЖЕ контракты на блоке нужной
 * даты и оценивает прочитанное котировками той же даты. Получается обычное
 * измерение, просто снятое задним числом.
 *
 * Что восстанавливается и откуда:
 *   * состояние сетей — архивное чтение на блоке, найденном по времени
 *     (lib/chains/historical.ts); блок выбирается по заголовкам, промах
 *     по времени печатается на каждую сеть;
 *   * цены — /coins/{id}/market_chart/range на тот же момент, БЛИЖАЙШАЯ
 *     фактическая точка ряда, без интерполяции;
 *   * всё остальное — журнал сделок, «внесено», цели, разметка зон и
 *     собственного капитала — тем же кодом, что и на живом пути
 *     (lib/portfolio/load.ts с подменённым источником сетевых данных).
 *
 * Чего восстановить НЕЛЬЗЯ, и это видно в выводе:
 *   * разметка «свои / заёмные» и доли капитала в позициях — они
 *     перезаписываются на месте, истории у них нет; берётся сегодняшняя;
 *   * суточные комиссии Uniswap — окно упёрлось бы в голову цепочки;
 *   * сети без ключа Alchemy — запасные узлы архив не держат.
 *
 * Безопасность:
 *   * без --apply только показывает, что получилось (dry-run по умолчанию);
 *   * существующая точка не трогается без --replace;
 *   * НАСТОЯЩЕЕ измерение не перезаписывается даже с --replace;
 *   * сегодняшний и будущий день не трогаются никогда.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertRemoteIfRequired, normalizeSupabaseUrl } from "./env-guard.ts";
import { buildHistoricalChainSource } from "@/lib/portfolio/historical-source";
import { createSnapshot } from "@/lib/portfolio/snapshot";

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
const date = arg("--date");
/**
 * Момент внутри дня. Умолчание — 03:00 UTC, время ежедневного cron'а:
 * восстановленная точка должна стоять в том же месте суток, что соседние,
 * иначе на графике появится ступенька из-за одного лишь сдвига часов.
 */
const at = arg("--at") ?? "03:00";
const email = arg("--email") ?? process.env.ADMIN_EMAIL;

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Укажите дату: --date YYYY-MM-DD");
  process.exit(1);
}
if (!/^\d{2}:\d{2}$/.test(at)) {
  console.error("Время указывается как --at HH:MM (UTC)");
  process.exit(1);
}
if (!email) {
  console.error("Укажите --email или задайте ADMIN_EMAIL");
  process.exit(1);
}

const targetMs = Date.parse(`${date}T${at}:00.000Z`);
if (Number.isNaN(targetMs)) {
  console.error(`Не разобрать момент ${date}T${at}Z`);
  process.exit(1);
}
const targetSec = Math.floor(targetMs / 1000);

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

const money = (value: number | null): string =>
  value === null ? "неизвестно" : `$${Math.round(value).toLocaleString("ru-RU")}`;

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  if (date! >= today) {
    // Сегодняшнюю точку снимает cron по-настоящему, а «восстановить»
    // будущее нельзя в принципе: блока ещё не существует
    console.error(
      `Дата ${date} не в прошлом (сегодня ${today}). Восстанавливать можно только завершившиеся дни.`,
    );
    process.exit(1);
  }

  const userId = await findUserId(email!);

  // --- Что уже есть за эту дату ---
  const { data: existingRows, error: existingError } = await admin
    .from("snapshots")
    .select("id, total_usd, is_partial, snapshot_items (composition)")
    .eq("user_id", userId)
    .eq("taken_on", date!);
  if (existingError) throw new Error(`snapshots: ${existingError.message}`);
  const existing = (existingRows ?? [])[0] as
    | {
        total_usd: number;
        is_partial: boolean;
        snapshot_items?: { composition?: { collateral?: unknown[] } | null }[];
      }
    | undefined;

  if (existing) {
    // Признак настоящего измерения — непустой состав залога: ровно так же
    // его опознаёт backfill, и правило одно на оба скрипта
    const measured = (existing.snapshot_items ?? []).some(
      (it) => (it.composition?.collateral?.length ?? 0) > 0,
    );
    if (measured) {
      console.error(
        `За ${date} уже есть НАСТОЯЩЕЕ измерение (${money(Number(existing.total_usd))}). ` +
          `Перезапись измерения не предусмотрена: откатить её нечем.`,
      );
      process.exit(1);
    }
    if (!replace) {
      console.error(
        `За ${date} уже есть точка (${money(Number(existing.total_usd))}). ` +
          `Добавьте --replace, чтобы заменить её восстановленной.`,
      );
      process.exit(1);
    }
  }

  console.log(`База:     ${url}`);
  console.log(`Владелец: ${email}`);
  console.log(`Момент:   ${date}T${at}:00Z${apply ? "" : "   [dry-run]"}`);
  console.log();

  // --- Архивное чтение ---
  console.log("Читаю состояние сетей на блоке той даты…");
  const { source, report } = await buildHistoricalChainSource(
    admin,
    userId,
    targetSec,
  );

  console.log("\nБлоки:");
  for (const [chain, pin] of Object.entries(report.blocks)) {
    const drift = pin.driftSec;
    const sign = drift > 0 ? "+" : "";
    console.log(
      `  ${chain.padEnd(9)} #${pin.block}  ${new Date(
        Number(pin.timestamp) * 1000,
      ).toISOString()}  (${sign}${drift} с от запрошенного момента)`,
    );
  }
  for (const f of report.failedChains) {
    console.log(`  ${f.chain.padEnd(9)} НЕ ПРОЧИТАНА: ${f.error}`);
  }

  // --- Сборка точки тем же кодом, что и живой путь ---
  console.log("\nСобираю снепшот…");
  const { snapshot, partialReasons } = await createSnapshot(
    admin,
    admin,
    userId,
    {
      readerScope: "admin",
      chainSource: source,
      // taken_on и taken_at считаются отсюда: точка встаёт на свою дату
      nowMs: targetMs,
      dryRun: !apply,
    },
  );

  if (report.missingPrices.length > 0) {
    console.log(`\nБез исторической цены: ${report.missingPrices.join(", ")}`);
  }
  for (const off of report.offPrices) {
    console.log(
      `Цена ${off.id} взята в ${Math.round(off.offsetSec / 60)} мин от момента`,
    );
  }

  console.log("\nТочка:");
  console.log(`  Стоимость портфеля   ${money(snapshot.totalUsd)}`);
  console.log(`  Долг                 ${money(snapshot.debtUsd)}`);
  console.log(`  Залог (оракул Aave)  ${money(snapshot.collateralUsd)}`);
  console.log(
    `  Health factor        ${
      snapshot.healthFactor === null ? "неизвестен" : snapshot.healthFactor.toFixed(2)
    }`,
  );
  console.log(`  Позиции              ${money(snapshot.positionsUsd)}`);
  console.log(`  Свободные            ${money(snapshot.freeUsd)}`);
  for (const item of snapshot.items) {
    console.log(
      `  ${item.category.padEnd(7)} ${
        item.quantity === null ? "кол-во неизвестно" : item.quantity.toFixed(4)
      } × ${item.priceUsd === null ? "нет цены" : `$${item.priceUsd.toFixed(2)}`} = ${money(
        item.valueUsd,
      )}`,
    );
  }

  if (partialReasons.length > 0) {
    console.log(`\nЧастичная (${partialReasons.length}):`);
    for (const reason of partialReasons) console.log(`  • ${reason}`);
  } else {
    console.log("\nПолная: все контуры прочитаны, все цены на месте.");
  }

  if (!apply) {
    console.log("\nЭто предпросмотр. Для записи добавьте --apply");
  } else {
    console.log(`\nГотово: точка за ${date} записана как измерение.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
