import type {
  LeverageResponseDto,
  PortfolioDto,
  WalletDto,
} from "@/lib/api/types";
import { chainLabel } from "@/lib/format";

/**
 * Что известно про адрес. Экрана «Кошельки» в API нет: WalletDto знает
 * только адрес, метку и время последнего чтения, поэтому сеть, стоимость
 * и состав протоколов собираются из уже существующих ответов —
 * /api/portfolio (залог Aave по кошелькам) и /api/leverage (позиции
 * Fluid / GMX / Uniswap с walletId). Новых эндпоинтов не заводим.
 *
 * Неизвестное здесь остаётся неизвестным: пустой список сетей — это «—»
 * в таблице, а не «0 сетей», и стоимость без цены не превращается в $0.
 */
export interface WalletFacts {
  /** Сети, в которых у адреса что-то прочитано; подписи уже человеческие. */
  chains: string[];
  /** Залог + оценённые позиции; null = не прочитано ничего с ценой. */
  valueUsd: number | null;
  /** Что приложение читает по этому адресу: «Aave», «Uniswap v3»… */
  reads: string[];
  /** Есть строки без цены — сумма в колонке неполная. */
  unpriced: boolean;
}

/** Ничего не прочитано: в таблице это «—», а не нули. */
export const EMPTY_FACTS: WalletFacts = {
  chains: [],
  valueUsd: null,
  reads: [],
  unpriced: false,
};

/** Залог читается модулем Aave — отдельного поля «протокол» у него нет. */
const COLLATERAL_PROTOCOL = "Aave";

/**
 * Свободные монеты — не протокол, а балансы самого адреса. В списке «что
 * читаем» стоят наравне с протоколами: до Фазы 7 подсказка обещала, что
 * балансы читаются всегда, а на деле их не читал никто.
 */
const FREE_BALANCES = "Балансы";

export function walletFacts(
  walletId: string,
  portfolio: PortfolioDto | null,
  leverage: LeverageResponseDto | null,
): WalletFacts {
  if (!portfolio && !leverage) return EMPTY_FACTS;

  const chains = new Set<string>();
  const reads = new Set<string>();
  let valueUsd = 0;
  let priced = false;
  let unpriced = false;

  for (const row of portfolio?.rows ?? []) {
    for (const c of row.collateralDetail) {
      if (c.walletId !== walletId) continue;
      chains.add(c.chain);
      reads.add(COLLATERAL_PROTOCOL);
      if (c.priceUsd === null) {
        unpriced = true;
      } else {
        valueUsd += c.valueUsd;
        priced = true;
      }
    }
  }

  // Свободные средства: заёмные тоже считаются — в колонке «Стоимость»
  // вопрос «сколько лежит на адресе», а не «сколько из этого моё»
  for (const row of portfolio?.rows ?? []) {
    for (const b of row.freeBalances) {
      if (b.walletId !== walletId) continue;
      chains.add(b.chain);
      reads.add(FREE_BALANCES);
      if (b.priceUsd === null) {
        unpriced = true;
      } else {
        valueUsd += b.valueUsd;
        priced = true;
      }
    }
  }

  for (const p of leverage?.positions ?? []) {
    if (p.walletId !== walletId) continue;
    chains.add(p.chain);
    reads.add(p.protocolLabel);
    if (p.valueUsd === null) {
      unpriced = true;
    } else {
      valueUsd += p.valueUsd;
      priced = true;
    }
  }

  return {
    chains: [...chains].map(chainLabel).sort((a, b) => a.localeCompare(b, "ru")),
    valueUsd: priced ? valueUsd : null,
    reads: [...reads].sort((a, b) => a.localeCompare(b, "ru")),
    unpriced,
  };
}

/**
 * Аббревиатура для плитки-тега 28px: инициалы метки, иначе две цифры
 * адреса. Плитка — метка источника, а не данные: цвет у неё нейтральный.
 */
export function walletTag(wallet: WalletDto): string {
  const label = wallet.label?.trim();
  if (label) {
    const words = label.split(/\s+/).filter(Boolean);
    const first = words[0] ?? "";
    const second = words[1];
    const abbr = second ? `${first[0]}${second[0]}` : first.slice(0, 2);
    if (abbr) return abbr.toUpperCase();
  }
  return wallet.address.replace(/^0x/i, "").slice(0, 2).toUpperCase();
}

/** «3 адреса», «1 адрес», «5 адресов» — счётчики в мета-строке заголовка. */
export function plural(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} ${many}`;
  if (mod10 === 1) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}
