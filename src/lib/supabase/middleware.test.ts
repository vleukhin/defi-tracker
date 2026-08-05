import { describe, expect, it } from "vitest";
import { isPublicApi } from "./middleware";

/**
 * Джобы Vercel Cron ходят без куки. Если прокси их не пропускает, они
 * молча получают 401 и не отрабатывают никогда — заметить это по продукту
 * почти нельзя: снепшот просто не появляется, алерт просто не приходит.
 *
 * Ровно так и вышло с /api/cron/health: список был перечнем точных путей,
 * и новый роут в него забыли внести. Тест держит правило «любой cron-роут
 * публичен по префиксу», чтобы следующий не пришлось чинить задним числом.
 */

describe("isPublicApi", () => {
  it("пропускает все cron-роуты по префиксу, включая будущие", () => {
    expect(isPublicApi("/api/cron/snapshot")).toBe(true);
    expect(isPublicApi("/api/cron/health")).toBe(true);
    expect(isPublicApi("/api/cron/что-нибудь-новое")).toBe(true);
  });

  it("пропускает health-чек мониторинга", () => {
    expect(isPublicApi("/api/health")).toBe(true);
  });

  it("не пропускает пользовательские роуты", () => {
    for (const path of [
      "/api/portfolio",
      "/api/zones",
      "/api/positions/mark",
      "/api/trades",
      "/api/snapshots",
    ]) {
      expect(isPublicApi(path)).toBe(false);
    }
  });

  it("похожий путь не считается cron-роутом", () => {
    // Префикс со слэшем: /api/cronjobs — это не /api/cron/
    expect(isPublicApi("/api/cronjobs")).toBe(false);
    expect(isPublicApi("/api/healthcheck")).toBe(false);
  });
});
