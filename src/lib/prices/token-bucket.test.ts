import { describe, expect, it } from "vitest";
import { TokenBucket } from "./token-bucket";

describe("TokenBucket (лимитер CoinGecko 25/мин)", () => {
  it("отдает не больше capacity токенов подряд", () => {
    const now = 0;
    const bucket = new TokenBucket(25, 25 / 60_000, () => now);
    for (let i = 0; i < 25; i++) expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    expect(bucket.msUntilNextToken()).toBeGreaterThan(0);
  });

  it("пополняется со временем и не превышает capacity", () => {
    let now = 0;
    const bucket = new TokenBucket(25, 25 / 60_000, () => now);
    for (let i = 0; i < 25; i++) bucket.tryTake();

    now = 2400; // 1 токен = 60000/25 = 2400 мс
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);

    now = 10 * 60_000; // 10 минут — но не больше 25
    for (let i = 0; i < 25; i++) expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it("take() ждет появления токена", async () => {
    let now = 0;
    const bucket = new TokenBucket(1, 1 / 1000, () => now);
    expect(bucket.tryTake()).toBe(true);

    const sleeps: number[] = [];
    await bucket.take(async (ms) => {
      sleeps.push(ms);
      now += ms; // «ждем» — двигаем время
    });
    expect(sleeps.length).toBeGreaterThan(0);
  });
});
