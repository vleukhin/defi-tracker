import { describe, expect, it } from "vitest";
import type { WalletDto } from "@/lib/api/types";
import { needsRefreshOnEnter } from "./refresh-policy";

const NOW = Date.parse("2026-08-05T12:00:00.000Z");
const MAX_AGE = 15 * 60_000;

function wallet(lastRefreshedAt: string | null): WalletDto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    address: "0x0000000000000000000000000000000000000001",
    label: null,
    lastRefreshedAt,
  };
}

/** Минуты назад относительно NOW, в ISO. */
function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

describe("needsRefreshOnEnter", () => {
  it("свежие данные — похода в блокчейн при входе нет", () => {
    expect(needsRefreshOnEnter([wallet(minutesAgo(3))], NOW, MAX_AGE)).toBe(
      false,
    );
  });

  it("данные старше порога — обновляем", () => {
    expect(needsRefreshOnEnter([wallet(minutesAgo(20))], NOW, MAX_AGE)).toBe(
      true,
    );
  });

  it("ровно на пороге считается устаревшим", () => {
    expect(needsRefreshOnEnter([wallet(minutesAgo(15))], NOW, MAX_AGE)).toBe(
      true,
    );
  });

  it("кошелёк не читался ни разу — обновляем", () => {
    expect(needsRefreshOnEnter([wallet(null)], NOW, MAX_AGE)).toBe(true);
  });

  it("нечитаемая отметка — обновляем: «неизвестно» это не «свежо»", () => {
    expect(needsRefreshOnEnter([wallet("позавчера")], NOW, MAX_AGE)).toBe(true);
  });

  it("решает худший кошелёк: один устарел — обновляются все", () => {
    const wallets = [wallet(minutesAgo(1)), wallet(minutesAgo(40))];
    expect(needsRefreshOnEnter(wallets, NOW, MAX_AGE)).toBe(true);
  });

  it("кошельков нет — обновлять нечего", () => {
    expect(needsRefreshOnEnter([], NOW, MAX_AGE)).toBe(false);
    expect(needsRefreshOnEnter(undefined, NOW, MAX_AGE)).toBe(false);
  });

  /**
   * Регрессия на цикл: после успешного обновления отметка становится свежей,
   * needsRefresh гаснет и эффект не уходит на второй круг.
   */
  it("после обновления отметка свежая — повторного захода не будет", () => {
    const before = [wallet(minutesAgo(30))];
    expect(needsRefreshOnEnter(before, NOW, MAX_AGE)).toBe(true);

    const after = [wallet(new Date(NOW).toISOString())];
    expect(needsRefreshOnEnter(after, NOW, MAX_AGE)).toBe(false);
  });
});
