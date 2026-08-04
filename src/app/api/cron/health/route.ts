import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Address } from "viem";
import { apiError } from "@/lib/api/auth";
import { checkCronSecret } from "@/lib/api/cron-auth";
import { DEFAULT_HF_WARNING_THRESHOLD } from "@/lib/api/settings";
import {
  evaluateHfAlert,
  type HfAlertState,
} from "@/lib/alerts/hf";
import {
  persistAaveHealth,
  persistDebtStatus,
  readWalletAaveHealth,
} from "@/lib/chains/aave-debt";
import { CHAIN_IDS } from "@/lib/chains/config";
import { buildHfMessage } from "@/lib/notifications/message";
import { sendToUser } from "@/lib/notifications/dispatch";
import { consumeTelegramUpdates } from "@/lib/notifications/telegram-link";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/cron/health — мониторинг health factor (каждые 15 минут).
 *
 * Метод GET, потому что Vercel Cron умеет только GET-запросы. Защита —
 * тот же CRON_SECRET, что у снепшотов: роут ходит под service-role и шлёт
 * сообщения, поэтому открытым быть не может.
 *
 * Почему отдельный роут, а не расширение снепшота. У них разная частота
 * (сутки против пятнадцати минут) и разная цена: снепшот обходит все
 * протоколы и цены, мониторинг читает одно число на сеть. Слить их значило
 * бы либо снимать снепшоты каждые пятнадцать минут, либо узнавать о
 * падении HF раз в сутки.
 *
 * Кого обходим. Только пользователей с подтверждённым включённым каналом:
 * читать блокчейн ради того, кому некуда слать, незачем. Побочный полезный
 * эффект для них же — экран «Долг» получает свежие HF без нажатия
 * «Обновить».
 *
 * Бюджет времени. Функция ограничена 60 секундами, работа линейна по числу
 * кошельков (4 multicall на кошелёк). По исчерпании мягкого бюджета
 * оставшиеся пользователи пропускаются: следующий прогон через пятнадцать
 * минут, а системный сбой поймает правило «HF не читается дольше 6 часов».
 */

export const runtime = "nodejs";
export const maxDuration = 60;
// `dynamic` не выставляется намеренно: в этой версии Next обработчики
// маршрутов не кэшируются по умолчанию, а чтение заголовка Authorization
// делает запрос динамическим в любом случае.

/** Порог, после которого оставшиеся пользователи пропускаются. */
const BUDGET_MS = 45_000;

interface WalletRow {
  id: string;
  address: string;
  label: string | null;
}

interface UserResult {
  userId: string;
  wallets: number;
  events: string[];
  sent: number;
  errors: string[];
}

/** Порог пользователя; строки user_settings может не быть — это дефолты. */
async function loadThreshold(
  admin: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await admin
    .from("user_settings")
    .select("hf_warning_threshold")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`user_settings select: ${error.message}`);
  return data === null
    ? DEFAULT_HF_WARNING_THRESHOLD
    : Number(data.hf_warning_threshold);
}

/** Состояние правил по кошелькам пользователя, ключ — «walletId:chain». */
async function loadAlertState(
  admin: SupabaseClient,
  walletIds: string[],
): Promise<Map<string, HfAlertState>> {
  const map = new Map<string, HfAlertState>();
  if (walletIds.length === 0) return map;

  const { data, error } = await admin
    .from("hf_alert_state")
    .select("wallet_id, chain, zone, notified_hf, notified_at")
    .in("wallet_id", walletIds);
  if (error) throw new Error(`hf_alert_state select: ${error.message}`);

  for (const row of data ?? []) {
    map.set(`${row.wallet_id}:${row.chain}`, {
      zone: row.zone,
      // numeric приходит строкой; null = долга тогда не было
      notifiedHf: row.notified_hf === null ? null : Number(row.notified_hf),
      notifiedAt: row.notified_at,
    });
  }
  return map;
}

interface CachedHealth {
  /** null = долга нет («∞»); это значение, а не отсутствие данных. */
  healthFactor: number | null;
  checkedAt: string;
}

/**
 * Последнее известное здоровье по сетям кошелька. Читается ПОСЛЕ записи
 * свежих данных: у прочитанных сетей значения новые, у непрочитанных
 * остались прежними — ровно та картина, которую должны видеть правила.
 */
async function loadHealthCache(
  admin: SupabaseClient,
  walletId: string,
): Promise<Map<string, CachedHealth>> {
  const { data, error } = await admin
    .from("aave_account_health")
    .select("chain, health_factor, checked_at")
    .eq("wallet_id", walletId);
  if (error) throw new Error(`aave_account_health select: ${error.message}`);

  const map = new Map<string, CachedHealth>();
  for (const row of data ?? []) {
    map.set(row.chain, {
      // numeric приходит строкой; null означает «долга нет»
      healthFactor: row.health_factor === null ? null : Number(row.health_factor),
      checkedAt: row.checked_at,
    });
  }
  return map;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();

  const denied = checkCronSecret(request);
  if (denied) return denied;

  const admin = createAdminClient();

  // 1. Привязки телеграма. Падение этого шага не отменяет мониторинг:
  // непривязанный канал — неудобство, непрочитанный HF — риск.
  let linked = 0;
  let linkError: string | undefined;
  try {
    const result = await consumeTelegramUpdates(admin);
    linked = result.linked;
    if (result.error) linkError = result.error;
  } catch (err) {
    linkError = err instanceof Error ? err.message : String(err);
    console.warn(`[cron-health] привязки не обработаны: ${linkError}`);
  }

  // 2. Кому есть смысл слать
  let userIds: string[];
  try {
    const { data, error } = await admin
      .from("notification_channels")
      .select("user_id")
      .eq("enabled", true)
      .not("verified_at", "is", null);
    if (error) throw new Error(error.message);
    userIds = [...new Set((data ?? []).map((r) => r.user_id as string))];
  } catch (err) {
    return apiError(
      500,
      `Не удалось получить список каналов: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const users: UserResult[] = [];
  let skipped = 0;

  for (const userId of userIds) {
    if (Date.now() - startedAt > BUDGET_MS) {
      skipped += 1;
      continue;
    }

    const result: UserResult = {
      userId,
      wallets: 0,
      events: [],
      sent: 0,
      errors: [],
    };

    try {
      const threshold = await loadThreshold(admin, userId);

      const { data: walletRows, error: walletError } = await admin
        .from("wallets")
        .select("id, address, label")
        .eq("user_id", userId);
      if (walletError) throw new Error(`wallets select: ${walletError.message}`);
      const wallets = (walletRows ?? []) as WalletRow[];
      result.wallets = wallets.length;

      const state = await loadAlertState(
        admin,
        wallets.map((w) => w.id),
      );

      for (const wallet of wallets) {
        // Бюджет проверяется и внутри: у одного пользователя может быть
        // много кошельков, и упереться в таймаут посреди списка нельзя
        if (Date.now() - startedAt > BUDGET_MS) {
          skipped += 1;
          break;
        }

        const statuses = await readWalletAaveHealth(wallet.address as Address);
        await persistAaveHealth(admin, wallet.id, statuses);
        await persistDebtStatus(admin, wallet.id, statuses);

        const cache = await loadHealthCache(admin, wallet.id);

        for (const chain of CHAIN_IDS) {
          const cached = cache.get(chain);
          // Наблюдение всегда берётся из кэша: он содержит либо только что
          // записанное свежее чтение, либо последнее известное. Так
          // «не прочитано» не выглядит как «долг погашен», а правило
          // слепоты видит настоящий возраст данных.
          const observation = {
            healthFactor: cached?.healthFactor ?? null,
            checkedAt: cached?.checkedAt ?? null,
          };

          const decision = evaluateHfAlert({
            prev: state.get(`${wallet.id}:${chain}`) ?? null,
            observation,
            threshold,
            now: Date.now(),
          });

          if (decision.event !== null) {
            const message = buildHfMessage({
              event: decision.event,
              chain,
              walletAddress: wallet.address,
              walletLabel: wallet.label,
              threshold,
            });
            const dispatch = await sendToUser(
              admin,
              userId,
              `hf:${decision.event.kind}`,
              message,
            );
            result.sent += dispatch.sent;
            result.errors.push(...dispatch.errors);
            result.events.push(`${chain}:${decision.event.kind}`);

            // Сообщение не ушло вообще — состояние не двигаем: иначе
            // событие считалось бы доставленным и не повторилось
            if (dispatch.sent === 0) continue;
          }

          if (decision.nextState !== null) {
            const { error } = await admin.from("hf_alert_state").upsert(
              {
                wallet_id: wallet.id,
                chain,
                zone: decision.nextState.zone,
                notified_hf: decision.nextState.notifiedHf,
                notified_at: decision.nextState.notifiedAt,
              },
              { onConflict: "wallet_id,chain" },
            );
            if (error) {
              throw new Error(`hf_alert_state upsert: ${error.message}`);
            }
            state.set(`${wallet.id}:${chain}`, decision.nextState);
          }
        }
      }
    } catch (err) {
      // Падение одного пользователя не отменяет остальных
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron-health] ${userId}: ${message}`);
      result.errors.push(message);
    }

    users.push(result);
  }

  return NextResponse.json({
    ran: users.length,
    linked,
    ...(linkError ? { linkError } : {}),
    skipped,
    events: users.reduce((sum, u) => sum + u.events.length, 0),
    users,
    durationMs: Date.now() - startedAt,
  });
}
