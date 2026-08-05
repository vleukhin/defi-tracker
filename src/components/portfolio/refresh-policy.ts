import type { WalletDto } from "@/lib/api/types";

/**
 * Нужно ли обновлять данные при входе на экран.
 *
 * POST /api/refresh — самая дорогая операция приложения: multicall по всем
 * сетям через Alchemy плюс CoinGecko, и следом три перезапроса экрана.
 * Раньше он уходил при КАЖДОМ входе, а от повторов защищал только серверный
 * дебаунс в 60 секунд — то есть любой заход спустя минуту стоил полного
 * похода в блокчейн, даже когда показывать он будет ровно то же самое.
 *
 * Отметка — та же, по которой считает дебаунс сервер
 * (`wallets.last_refreshed_at`), и по худшему из кошельков: не прочитан один
 * — данные портфеля уже неполные, обновляем.
 *
 * Порог задаётся снаружи и равен интервалу автообновления: ровно столько
 * экран живёт на этих данных между тиками, так что более свежие обновлять
 * незачем.
 */
export function needsRefreshOnEnter(
  wallets: WalletDto[] | undefined,
  nowMs: number,
  maxAgeMs: number,
): boolean {
  // Нет кошельков — обновлять нечего, читать нечего
  if (!wallets || wallets.length === 0) return false;

  return wallets.some((w) => {
    const at = w.lastRefreshedAt === null ? NaN : Date.parse(w.lastRefreshedAt);
    // Кошелёк не читался ни разу или отметка нечитаема — обновляем:
    // «неизвестно» это не «свежо»
    if (!Number.isFinite(at)) return true;
    return nowMs - at >= maxAgeMs;
  });
}
