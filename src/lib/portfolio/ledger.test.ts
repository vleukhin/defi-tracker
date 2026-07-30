import { describe, expect, it } from "vitest";
import {
  buildLedgerRowInfo,
  replayTrades,
  type LedgerTrade,
} from "./ledger";

/** Сделка с разумными дефолтами; created_at по умолчанию равен traded_at. */
function trade(over: Partial<LedgerTrade> = {}): LedgerTrade {
  const tradedAt = over.tradedAt ?? "2026-07-01T12:00:00.000Z";
  return {
    category: "btc",
    side: "buy",
    quantity: "1",
    priceUsd: "60000",
    feeUsd: null,
    tradedAt,
    createdAt: over.createdAt ?? tradedAt,
    ...over,
  };
}

describe("replayTrades: формулы ТЗ S2.1", () => {
  it("контрольный пример: две покупки → взвешенная средняя, продажа не меняет среднюю", () => {
    // buy 1 BTC @60000, buy 1 @70000 → avg 65000; sell 0.5 @80000 →
    // avg по-прежнему 65000, realized = 0.5 × (80000 − 65000) = 7500
    const res = replayTrades([
      trade({ quantity: "1", priceUsd: "60000", tradedAt: "2026-07-01T00:00:00Z" }),
      trade({ quantity: "1", priceUsd: "70000", tradedAt: "2026-07-02T00:00:00Z" }),
      trade({
        side: "sell",
        quantity: "0.5",
        priceUsd: "80000",
        tradedAt: "2026-07-03T00:00:00Z",
      }),
    ]);
    expect(res.btc.avgPriceUsd).toBeCloseTo(65000, 8);
    expect(res.btc.ledgerQty).toBeCloseTo(1.5, 12);
    expect(res.btc.realizedPnlUsd).toBeCloseTo(7500, 8);
    expect(res.btc.warnings).toEqual([]);
    expect(res.btc.tradeCount).toBe(3);
  });

  it("покупки разного объема: средняя взвешена по количеству, не арифметическая", () => {
    // (2×50000 + 1×80000) / 3 = 60000
    const res = replayTrades([
      trade({ quantity: "2", priceUsd: "50000", tradedAt: "2026-07-01T00:00:00Z" }),
      trade({ quantity: "1", priceUsd: "80000", tradedAt: "2026-07-02T00:00:00Z" }),
    ]);
    expect(res.btc.avgPriceUsd).toBeCloseTo(60000, 8);
    expect(res.btc.ledgerQty).toBe(3);
  });

  it("пустой леджер: средняя null (не ноль), количества и суммы нулевые", () => {
    const res = replayTrades([]);
    for (const category of ["btc", "eth", "stable"] as const) {
      expect(res[category]).toEqual({
        ledgerQty: 0,
        avgPriceUsd: null,
        realizedPnlUsd: 0,
        totalFeesUsd: 0,
        warnings: [],
        tradeCount: 0,
      });
    }
  });

  it("oversell: предупреждение с датой и объемом, кламп в 0, realized на весь объем по средней", () => {
    const res = replayTrades([
      trade({ quantity: "1", priceUsd: "60000", tradedAt: "2026-07-01T00:00:00Z" }),
      trade({
        side: "sell",
        quantity: "2",
        priceUsd: "70000",
        tradedAt: "2026-07-10T00:00:00Z",
      }),
    ]);
    expect(res.btc.ledgerQty).toBe(0); // кламп, не −1
    expect(res.btc.warnings).toHaveLength(1);
    expect(res.btc.warnings[0]).toContain("2026-07-10");
    expect(res.btc.warnings[0]).toContain("2 BTC");
    // Вся продажа считается по средней 60000: 2 × (70000 − 60000) = 20000
    expect(res.btc.realizedPnlUsd).toBeCloseTo(20000, 8);
    // Средняя не трогается продажей даже при oversell
    expect(res.btc.avgPriceUsd).toBeCloseTo(60000, 8);
  });

  it("продажа до первой покупки: предупреждение, realized не начисляется (базы нет)", () => {
    const res = replayTrades([
      trade({ side: "sell", quantity: "1", priceUsd: "70000" }),
    ]);
    expect(res.btc.avgPriceUsd).toBeNull();
    expect(res.btc.realizedPnlUsd).toBe(0);
    expect(res.btc.ledgerQty).toBe(0);
    expect(res.btc.warnings).toHaveLength(1);
  });

  it("после обнуления количества следующая покупка начинает среднюю заново", () => {
    const res = replayTrades([
      trade({ quantity: "1", priceUsd: "60000", tradedAt: "2026-07-01T00:00:00Z" }),
      trade({
        side: "sell",
        quantity: "1",
        priceUsd: "90000",
        tradedAt: "2026-07-02T00:00:00Z",
      }),
      trade({ quantity: "2", priceUsd: "40000", tradedAt: "2026-07-03T00:00:00Z" }),
    ]);
    // Средняя 40000 — история до обнуления не подмешивается
    expect(res.btc.avgPriceUsd).toBeCloseTo(40000, 8);
    expect(res.btc.ledgerQty).toBe(2);
    // Realized первой продажи при этом сохранен: 1 × (90000 − 60000)
    expect(res.btc.realizedPnlUsd).toBeCloseTo(30000, 8);
    expect(res.btc.warnings).toEqual([]);
  });

  it("продажа «всего» с пылью double-арифметики не дает oversell-предупреждения", () => {
    // 0.1 + 0.2 = 0.30000000000000004 в double
    const res = replayTrades([
      trade({ quantity: "0.1", priceUsd: "60000", tradedAt: "2026-07-01T00:00:00Z" }),
      trade({ quantity: "0.2", priceUsd: "60000", tradedAt: "2026-07-02T00:00:00Z" }),
      trade({
        side: "sell",
        quantity: "0.3",
        priceUsd: "60000",
        tradedAt: "2026-07-03T00:00:00Z",
      }),
    ]);
    expect(res.btc.warnings).toEqual([]);
    expect(res.btc.ledgerQty).toBe(0); // пыль срезана, следующая покупка — сброс средней
  });

  it("комиссии не входят в среднюю и копятся отдельно по обеим сторонам", () => {
    const res = replayTrades([
      trade({
        quantity: "1",
        priceUsd: "60000",
        feeUsd: "25",
        tradedAt: "2026-07-01T00:00:00Z",
      }),
      trade({
        side: "sell",
        quantity: "0.5",
        priceUsd: "70000",
        feeUsd: "10.5",
        tradedAt: "2026-07-02T00:00:00Z",
      }),
    ]);
    expect(res.btc.avgPriceUsd).toBeCloseTo(60000, 8); // без комиссии
    expect(res.btc.realizedPnlUsd).toBeCloseTo(5000, 8); // тоже без комиссии
    expect(res.btc.totalFeesUsd).toBeCloseTo(35.5, 8);
  });

  it("категория stable: количества в USD, цена около 1", () => {
    const res = replayTrades([
      trade({
        category: "stable",
        quantity: "10000",
        priceUsd: "1",
        tradedAt: "2026-07-01T00:00:00Z",
      }),
      trade({
        category: "stable",
        quantity: "5000",
        priceUsd: "0.998",
        tradedAt: "2026-07-02T00:00:00Z",
      }),
    ]);
    expect(res.stable.ledgerQty).toBe(15000);
    expect(res.stable.avgPriceUsd).toBeCloseTo((10000 * 1 + 5000 * 0.998) / 15000, 12);
    // BTC/ETH не затронуты
    expect(res.btc.tradeCount).toBe(0);
    expect(res.eth.tradeCount).toBe(0);
  });

  it("категории считаются независимо", () => {
    const res = replayTrades([
      trade({ category: "btc", quantity: "1", priceUsd: "60000" }),
      trade({ category: "eth", quantity: "10", priceUsd: "2000" }),
    ]);
    expect(res.btc.avgPriceUsd).toBeCloseTo(60000, 8);
    expect(res.eth.avgPriceUsd).toBeCloseTo(2000, 8);
    expect(res.eth.ledgerQty).toBe(10);
  });

  it("реплей идет по traded_at, а не по created_at и не по порядку в массиве", () => {
    // Продажа записана в журнал РАНЬШЕ покупки (created_at), но торгована ПОЗЖЕ:
    // корректный реплей — сначала покупка, потом продажа, без предупреждений.
    const res = replayTrades([
      trade({
        side: "sell",
        quantity: "1",
        priceUsd: "70000",
        tradedAt: "2026-07-05T00:00:00Z",
        createdAt: "2026-07-01T00:00:00Z",
      }),
      trade({
        quantity: "1",
        priceUsd: "60000",
        tradedAt: "2026-07-01T00:00:00Z",
        createdAt: "2026-07-09T00:00:00Z",
      }),
    ]);
    expect(res.btc.warnings).toEqual([]);
    expect(res.btc.realizedPnlUsd).toBeCloseTo(10000, 8);
    expect(res.btc.ledgerQty).toBe(0);
  });

  it("при равных traded_at порядок определяет created_at", () => {
    const sameDay = "2026-07-01T00:00:00Z";
    const res = replayTrades([
      // Продажа создана позже покупки → применяется второй, oversell нет
      trade({
        side: "sell",
        quantity: "1",
        priceUsd: "70000",
        tradedAt: sameDay,
        createdAt: "2026-07-01T10:00:00Z",
      }),
      trade({
        quantity: "1",
        priceUsd: "60000",
        tradedAt: sameDay,
        createdAt: "2026-07-01T09:00:00Z",
      }),
    ]);
    expect(res.btc.warnings).toEqual([]);
    expect(res.btc.realizedPnlUsd).toBeCloseTo(10000, 8);
  });
});

describe("buildLedgerRowInfo: unrealized P/L и расхождение (S2.2)", () => {
  const bought = replayTrades([
    trade({ quantity: "1", priceUsd: "60000", tradedAt: "2026-07-01T00:00:00Z" }),
    trade({ quantity: "1", priceUsd: "70000", tradedAt: "2026-07-02T00:00:00Z" }),
  ]).btc; // avg 65000, qty 2

  it("unrealized = qty × (текущая − средняя), % = (текущая/средняя − 1) × 100", () => {
    const info = buildLedgerRowInfo(bought, {
      currentPriceUsd: 78000,
      actualQty: 2,
    });
    expect(info.unrealizedPnlUsd).toBeCloseTo(2 * (78000 - 65000), 8);
    expect(info.unrealizedPnlPct).toBeCloseTo((78000 / 65000 - 1) * 100, 8);
    expect(info.avgPriceUsd).toBeCloseTo(65000, 8);
    expect(info.discrepancy).toBeNull(); // совпадает точно
  });

  it("нет сделок → нули не выдумываются: средняя и unrealized равны null", () => {
    const empty = replayTrades([]).eth;
    const info = buildLedgerRowInfo(empty, {
      currentPriceUsd: 2000,
      actualQty: 5,
    });
    expect(info.avgPriceUsd).toBeNull();
    expect(info.unrealizedPnlUsd).toBeNull();
    expect(info.unrealizedPnlPct).toBeNull();
    expect(info.realizedPnlUsd).toBe(0);
    expect(info.discrepancy).toBeNull(); // без сделок сравнивать нечего
  });

  it("нет текущей цены → unrealized null, средняя остается", () => {
    const info = buildLedgerRowInfo(bought, {
      currentPriceUsd: null,
      actualQty: null,
    });
    expect(info.avgPriceUsd).toBeCloseTo(65000, 8);
    expect(info.unrealizedPnlUsd).toBeNull();
    expect(info.unrealizedPnlPct).toBeNull();
    expect(info.discrepancy).toBeNull();
  });

  it("расхождение больше 1% → мягкое предупреждение с величиной", () => {
    const info = buildLedgerRowInfo(bought, {
      currentPriceUsd: 70000,
      actualQty: 2.5,
    });
    expect(info.discrepancy).toEqual({
      ledgerQty: 2,
      actualQty: 2.5,
      diff: 2 - 2.5,
    });
  });

  it("расхождение в пределах 1% не показывается", () => {
    const info = buildLedgerRowInfo(bought, {
      currentPriceUsd: 70000,
      actualQty: 2.01, // 0.5% от 2.01
    });
    expect(info.discrepancy).toBeNull();
  });

  it("леджер есть, факта нет вообще (ноль): расхождение показывается", () => {
    const info = buildLedgerRowInfo(bought, {
      currentPriceUsd: 70000,
      actualQty: 0,
    });
    expect(info.discrepancy).toEqual({ ledgerQty: 2, actualQty: 0, diff: 2 });
  });
});
