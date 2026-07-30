import { describe, expect, it } from "vitest";
import { normalizeSupabaseUrl } from "./url";

/**
 * Регрессия боевой ошибки: в переменную окружения на Vercel попал REST-адрес,
 * клиент собирал запросы вида /rest/v1/auth/v1/token и вход молча не работал.
 */
describe("normalizeSupabaseUrl", () => {
  const base = "https://abcdefgh.supabase.co";

  it("оставляет базовый адрес как есть", () => {
    expect(normalizeSupabaseUrl(base)).toBe(base);
  });

  it("срезает REST-адрес — та самая ошибка на проде", () => {
    expect(normalizeSupabaseUrl(`${base}/rest/v1/`)).toBe(base);
    expect(normalizeSupabaseUrl(`${base}/rest/v1`)).toBe(base);
  });

  it("срезает прочие сервисные пути", () => {
    for (const suffix of ["/auth/v1", "/storage/v1", "/realtime/v1", "/graphql/v1"]) {
      expect(normalizeSupabaseUrl(base + suffix)).toBe(base);
    }
  });

  it("убирает завершающие слеши и пробелы по краям", () => {
    expect(normalizeSupabaseUrl(`  ${base}///  `)).toBe(base);
  });

  it("не трогает локальный адрес", () => {
    expect(normalizeSupabaseUrl("http://127.0.0.1:54321")).toBe(
      "http://127.0.0.1:54321",
    );
  });
});
