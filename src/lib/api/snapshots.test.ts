import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERIOD,
  mapSnapshotRow,
  periodCutoff,
  snapshotPeriodSchema,
  type SnapshotRow,
} from "./snapshots";

const NOW = Date.parse("2026-07-30T03:00:00.000Z");

describe("periodCutoff", () => {
  it("считает границу включительно: 7d = сегодня и шесть предыдущих дней", () => {
    expect(periodCutoff("7d", NOW)).toBe("2026-07-24");
  });

  it("30d / 90d / 1y", () => {
    expect(periodCutoff("30d", NOW)).toBe("2026-07-01");
    expect(periodCutoff("90d", NOW)).toBe("2026-05-02");
    expect(periodCutoff("1y", NOW)).toBe("2025-07-31");
  });

  it("all — без нижней границы", () => {
    expect(periodCutoff("all", NOW)).toBeNull();
  });

  it("период по умолчанию — месяц", () => {
    expect(DEFAULT_PERIOD).toBe("30d");
    expect(snapshotPeriodSchema.safeParse("42d").success).toBe(false);
    expect(snapshotPeriodSchema.safeParse("1y").success).toBe(true);
  });
});

describe("mapSnapshotRow", () => {
  const row: SnapshotRow = {
    id: "ccb4e567-97fe-471c-90dd-dfa8d7c31742",
    taken_on: "2026-07-30",
    taken_at: "2026-07-30T03:00:01.000Z",
    // numeric приезжает из PostgREST строкой
    total_usd: "153670.6754465164",
    is_partial: false,
    snapshot_items: [
      {
        category: "stable",
        quantity: "39548",
        price_usd: "1",
        value_usd: "39548",
        percent: "25.735",
        collateral_usd: "0",
        manual_usd: "39548",
      },
      {
        category: "btc",
        quantity: "1.2606477",
        price_usd: "64749",
        value_usd: "81625.68",
        percent: "53.117",
        collateral_usd: "81625.68",
        manual_usd: "0",
      },
    ],
  };

  it("приводит numeric-строки к числам", () => {
    const dto = mapSnapshotRow(row);

    expect(dto.totalUsd).toBeCloseTo(153670.6754465164, 6);
    const btc = dto.items.find((i) => i.category === "btc")!;
    expect(btc.valueUsd).toBe(81625.68);
    expect(btc.priceUsd).toBe(64749);
  });

  it("порядок состава фиксирован (btc, eth, stable), а не как отдала БД", () => {
    expect(mapSnapshotRow(row).items.map((i) => i.category)).toEqual([
      "btc",
      "stable",
    ]);
  });

  it("отсутствие цены остается null, а не превращается в 0", () => {
    const dto = mapSnapshotRow({
      ...row,
      snapshot_items: [
        {
          category: "btc",
          quantity: null,
          price_usd: null,
          value_usd: "0",
          percent: "0",
          collateral_usd: "0",
          manual_usd: "0",
        },
      ],
    });

    expect(dto.items[0].quantity).toBeNull();
    expect(dto.items[0].priceUsd).toBeNull();
    expect(dto.items[0].valueUsd).toBe(0);
  });

  it("снепшот без колонки free_borrowed_usd отдает null, а не ноль", () => {
    // Ноль означал бы «заемных на кошельке не было»; точка о них не знала,
    // и Прибыль по ней посчитать нельзя — но врать про ноль нельзя тем более
    expect(mapSnapshotRow(row).freeBorrowedUsd).toBeNull();
    expect(mapSnapshotRow({ ...row, free_borrowed_usd: "20000" }).freeBorrowedUsd).toBe(
      20_000,
    );
  });

  it("снепшот без состава не роняет маппинг", () => {
    expect(mapSnapshotRow({ ...row, snapshot_items: null }).items).toEqual([]);
  });
});
