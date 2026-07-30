import { describe, expect, it } from "vitest";
import { getAddress, isAddress, parseUnits } from "viem";
import { z } from "zod";

/**
 * Smoke-тест окружения: vitest работает, ключевые зависимости импортируются
 * и ведут себя ожидаемо. Содержательные тесты (изоляция RLS, формулы
 * аллокации, decimals) появятся вместе с соответствующими модулями.
 */
describe("smoke", () => {
  it("zod валидирует схему", () => {
    const schema = z.object({ email: z.email() });
    expect(schema.safeParse({ email: "user@example.com" }).success).toBe(true);
    expect(schema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("viem проверяет EIP-55 checksum адреса", () => {
    // vitalik.eth — валидный checksum
    const checksummed = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    expect(isAddress(checksummed)).toBe(true);
    expect(getAddress(checksummed.toLowerCase())).toBe(checksummed);
    // Испорченный checksum (в strict-режиме)
    expect(isAddress("0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045", { strict: true })).toBe(false);
  });

  it("viem не предполагает 18 decimals (USDC=6, WBTC=8)", () => {
    expect(parseUnits("1", 6)).toBe(1_000_000n);
    expect(parseUnits("1", 8)).toBe(100_000_000n);
    expect(parseUnits("1", 18)).toBe(1_000_000_000_000_000_000n);
  });
});
