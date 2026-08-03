import { CATEGORY_LABEL } from "@/components/portfolio/category";
import type { PortfolioCategory } from "@/lib/api/types";

/**
 * Подписи компактных карточек количеств. Отличаются от общих подписей
 * категорий по делу: карточка отвечает на вопрос «сколько монет», а это
 * главная метрика стратегии. У стейблов «количество» звучало бы как
 * количество монет, поэтому третья карточка называется просто «Стейблы».
 */
export const HISTORY_CARD_LABEL: Record<PortfolioCategory, string> = {
  btc: "Количество BTC",
  eth: "Количество ETH",
  stable: CATEGORY_LABEL.stable,
};

export { CATEGORY_LABEL as HISTORY_CATEGORY_LABEL };
