import { describe, expect, it } from "vitest";
import type {
  DebtChainDto,
  DebtResponseDto,
  PortfolioDto,
  PositionDto,
  ZonesSummaryDto,
} from "@/lib/api/types";
import {
  ackedSignals,
  activeSignals,
  buildSignals,
  hasPendingSources,
  type SignalKind,
  type SignalsInput,
} from "./signals";

/**
 * Лента «Что делать сейчас» (docs/07 §5–§7).
 *
 * Проверяется не арифметика — её считают gm-levels, range-timer, risk и
 * hf-zones, и у каждого свои тесты, — а три вещи, которые есть только здесь:
 * что попадает в ленту, в каком порядке и что лента НИКОГДА не выдаёт
 * непрочитанные данные за спокойствие.
 */

const NOW = Date.parse("2026-08-05T12:00:00.000Z"); // среда

function hoursAgo(hours: number): string {
  return new Date(NOW - hours * 3_600_000).toISOString();
}

// --- фабрики -------------------------------------------------------------

function chain(overrides: Partial<DebtChainDto> = {}): DebtChainDto {
  return {
    chain: "arbitrum",
    totalCollateralUsd: 100_000,
    totalDebtUsd: 48_000,
    healthFactor: 1.74,
    utilization: 0.48,
    items: [
      { symbol: "USDC", chain: "arbitrum", quantity: "48000", valueUsd: 48_000 },
    ],
    checkedAt: hoursAgo(0.2),
    ...overrides,
  };
}

function debt(
  chains: DebtChainDto[] = [chain()],
  summary: Partial<DebtResponseDto["summary"]> = {},
): DebtResponseDto {
  const hfs = chains
    .map((c) => c.healthFactor)
    .filter((hf): hf is number => hf !== null);
  return {
    chains,
    summary: {
      totalDebtUsd: 48_000,
      minHealthFactor: hfs.length > 0 ? Math.min(...hfs) : null,
      hfWarningThreshold: 1.5,
      belowThreshold: hfs.length > 0 && Math.min(...hfs) < 1.5,
      targetLtvPct: 50,
      ...summary,
    },
  };
}

function portfolio(overrides: Partial<PortfolioDto> = {}): PortfolioDto {
  return {
    totalUsd: 150_000,
    overview: {
      assetsUsd: 150_000,
      debtUsd: 48_000,
      netUsd: 102_000,
      depositedUsd: 90_000,
      profitUsd: 12_000,
    } as PortfolioDto["overview"],
    rows: [],
    targetSumPct: 100,
    freshness: {
      oldestPriceAt: hoursAgo(0.1),
      oldestCollateralAt: hoursAgo(0.1),
      anyPriceStale: false,
    },
    chains: [
      { chain: "arbitrum", ok: true, checkedAt: hoursAgo(0.1) },
    ],
    freeChains: [{ chain: "arbitrum", ok: true, checkedAt: hoursAgo(0.1) }],
    freeSummary: {
      ownUsd: 0,
      borrowedUsd: 0,
      unmarkedCount: 0,
      dust: { count: 0, valueUsd: 0 },
      other: [],
    },
    wallets: [
      {
        id: "w1",
        address: "0x1",
        label: null,
        lastRefreshedAt: hoursAgo(0.1),
      },
    ],
    // Разрез по зонам приезжает в том же ответе, что и категории. Лента берет
    // его из отдельных полей SignalsInput, поэтому здесь достаточно пустых
    // значений — но тип обязан быть полным, иначе фикстура врет об API
    zones: zones(),
    positions: [],
    positionsSummary: {
      positionsUsd: 0,
      grossUsd: 0,
      ownUsd: 0,
      profitUsd: 0,
      unpricedCount: 0,
      unmarkedCount: 0,
    },
    stableBorrow: { ratePercent: null, debtUsd: 0, reserves: [] },
    ...overrides,
  };
}

function zones(overrides: Partial<ZonesSummaryDto> = {}): ZonesSummaryDto {
  return {
    zones: [],
    totalUsd: 150_000,
    ownInPositionsUsd: 0,
    unpricedPositions: 0,
    unmarkedPositions: 0,
    freeOwnUsd: 0,
    freeBorrowedUsd: 0,
    unmarkedFree: 0,
    ...overrides,
  };
}

function position(overrides: Partial<PositionDto> = {}): PositionDto {
  return {
    id: "p1",
    protocol: "gmx_v2",
    protocolLabel: "GMX v2",
    chain: "arbitrum",
    zone: "yield",
    zoneKey: "gmx_v2:arbitrum:p1",
    ownPrincipalUsd: 0,
    borrowedPrincipalUsd: 20_800,
    withdrawnUsd: null,
    entryPriceUsd: null,
    ownCurrentUsd: 0,
    profitUsd: null,
    profitPct: null,
    title: "GM BTC",
    subtitle: null,
    quantity: "1",
    valueUsd: 8_046,
    components: [],
    feesUsd: null,
    fees24hUsd: null,
    fees24hReason: null,
    inRange: null,
    outOfRangeSince: null,
    range: null,
    supplyRatePercent: null,
    rewardsRatePercent: null,
    walletId: "w1",
    walletLabel: null,
    updatedAt: hoursAgo(0.1),
    ...overrides,
  };
}

/** GM-пул: цена базового актива задаётся длинной стороной. */
function gm({
  id = "p1",
  entryPriceUsd = 100_000,
  priceUsd = 100_000,
  valueUsd = 10_000,
  symbol = "BTC",
}: {
  id?: string;
  entryPriceUsd?: number | null;
  priceUsd?: number | null;
  valueUsd?: number | null;
  symbol?: string;
} = {}): PositionDto {
  return position({
    id,
    protocol: "gmx_v2",
    entryPriceUsd,
    valueUsd,
    title: `GM ${symbol}`,
    components: [
      { symbol, quantity: 1, valueUsd: priceUsd, side: "long" },
      { symbol: "USDC", quantity: 5_000, valueUsd: 5_000, side: "short" },
    ],
  });
}

/** CLMM-позиция Uniswap: вне диапазона с заданного момента. */
function lp({
  id = "lp1",
  inRange = false,
  outOfRangeSince = hoursAgo(25),
  held = "WETH",
}: {
  id?: string;
  inRange?: boolean | null;
  outOfRangeSince?: string | null;
  held?: string;
} = {}): PositionDto {
  return position({
    id,
    protocol: "uni_v3",
    protocolLabel: "Uniswap v3",
    title: "WETH/USDC 0,05%",
    inRange,
    outOfRangeSince,
    components: [
      { symbol: held, quantity: 8.2, valueUsd: 16_000, side: null },
      { symbol: held === "WETH" ? "USDC" : "WETH", quantity: 0, valueUsd: 0, side: null },
    ],
  });
}

/** Депозит лендинга со ставкой — единственный, у кого спред осмыслен. */
function fluid({
  id = "f1",
  supplyRatePercent = 4.48,
  rewardsRatePercent = null,
  symbol = "USDC",
}: {
  id?: string;
  supplyRatePercent?: number | null;
  rewardsRatePercent?: number | null;
  symbol?: string;
} = {}): PositionDto {
  return position({
    id,
    protocol: "fluid",
    protocolLabel: "Fluid",
    title: "fUSDC",
    valueUsd: 20_000,
    supplyRatePercent,
    rewardsRatePercent,
    components: [{ symbol, quantity: 20_000, valueUsd: 20_000, side: null }],
  });
}

/** Дефолт: всё спокойно и всё прочитано. */
function input(overrides: Partial<SignalsInput> = {}): SignalsInput {
  return {
    portfolio: portfolio(),
    debt: debt(),
    positions: [],
    zones: zones(),
    assetsUsd: 150_000,
    stableBorrowRatePercent: 4.9,
    targetLtvPct: 50,
    acks: [],
    pending: { portfolio: false, debt: false, zones: false, acks: false },
    runtime: {
      debtError: null,
      zonesError: null,
      refreshError: null,
      chainIssues: [],
    },
    ...overrides,
  };
}

/**
 * То, что лента показывает: отмеченные выполненными сюда не входят —
 * buildSignals возвращает и их тоже, свёрнутым списком внизу карточки.
 */
function kinds(inp: SignalsInput, nowMs = NOW): SignalKind[] {
  return activeSignals(buildSignals(inp, nowMs)).map((s) => s.kind);
}

// --- порядок -------------------------------------------------------------

describe("порядок задан стратегией", () => {
  it("риск ликвидации идёт первым, гигиена последней", () => {
    const inp = input({
      debt: debt([chain({ healthFactor: 1.28, totalDebtUsd: 60_000 })]),
      positions: [gm({ priceUsd: 84_000 }), lp({ outOfRangeSince: hoursAgo(51) })],
      zones: zones({ unmarkedPositions: 3 }),
    });

    expect(kinds(inp)).toEqual([
      "hf-below",
      "gm-level",
      "clmm-ready",
      "positions-unmarked",
    ]);
  });

  it("глубокий уровень GM выше мелкого", () => {
    const inp = input({
      positions: [
        gm({ id: "shallow", priceUsd: 92_000 }), // −8%
        gm({ id: "deep", priceUsd: 68_000 }), // −32%
      ],
    });
    const levels = buildSignals(inp, NOW).filter((s) => s.kind === "gm-level");
    expect(levels.map((s) => s.key)).toEqual([
      "gm-level:deep",
      "gm-level:shallow",
    ]);
  });

  it("вышедший срок CLMM выше идущего, каким бы долгим тот ни был", () => {
    const inp = input({
      positions: [
        lp({ id: "waiting", outOfRangeSince: hoursAgo(47) }),
        lp({ id: "ready", outOfRangeSince: hoursAgo(49) }),
      ],
    });
    expect(kinds(inp)).toEqual(["clmm-ready", "clmm-waiting"]);
  });

  it("порядок не зависит от порядка массива позиций", () => {
    const a = gm({ id: "a", priceUsd: 85_000 });
    const b = gm({ id: "b", priceUsd: 85_000 });
    expect(buildSignals(input({ positions: [a, b] }), NOW)).toEqual(
      buildSignals(input({ positions: [b, a] }), NOW),
    );
  });
});

// --- HF и слепота --------------------------------------------------------

describe("риск ликвидации", () => {
  it("HF ниже порога — сигнал называет и HF, и сам порог", () => {
    const signals = buildSignals(
      input({ debt: debt([chain({ healthFactor: 1.42 })]) }),
      NOW,
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe("hf-below");
    expect(signals[0].tone).toBe("loss");
    expect(signals[0].title).toContain("1,42");
    expect(signals[0].title).toContain("ниже порога 1,50");
    expect(signals[0].chip).toBe("HF 1,42");
  });

  it("1,30 и 1,20 заданы стратегией: 1,28 экстренный даже при пороге 1,10", () => {
    const inp = input({
      debt: debt([chain({ healthFactor: 1.28 })], { hfWarningThreshold: 1.1 }),
    });
    const signals = buildSignals(inp, NOW);
    expect(signals[0].kind).toBe("hf-below");
    expect(signals[0].title).toContain("экстренный уровень");
  });

  it("зона «близко к порогу» сигналом не становится: действий там нет", () => {
    expect(kinds(input({ debt: debt([chain({ healthFactor: 1.7 })]) }))).toEqual(
      [],
    );
  });

  it("экстренный уровень называет меру стратегии, а не запас падения", () => {
    const signals = buildSignals(
      input({ debt: debt([chain({ healthFactor: 1.15 })]) }),
      NOW,
    );
    expect(signals[0].detail).toContain("1,30");
    expect(signals[0].detail).toContain("1,50");
    expect(signals[0].detail).toContain("GM");
  });

  it("долга нет — сигнала нет: HF «∞» это не пробел", () => {
    const inp = input({
      debt: debt(
        [
          chain({
            healthFactor: null,
            totalDebtUsd: 0,
            totalCollateralUsd: 0,
            items: [],
          }),
        ],
        { totalDebtUsd: 0, minHealthFactor: null },
      ),
    });
    expect(kinds(inp)).toEqual([]);
  });

  it("HF не прочитан там, где долг есть — сигнал уровня ликвидации", () => {
    const inp = input({
      debt: debt([chain({ healthFactor: null })]),
    });
    const signals = buildSignals(inp, NOW);
    expect(signals.map((s) => s.kind)).toEqual(["hf-unread"]);
    expect(signals[0].severity).toBe("liquidation");
  });

  it("сеть молчит дольше шести часов — слепота названа числом", () => {
    const inp = input({ debt: debt([chain({ checkedAt: hoursAgo(9) })]) });
    const signals = buildSignals(inp, NOW);
    expect(signals.map((s) => s.kind)).toEqual(["hf-stale"]);
    expect(signals[0].chip).toBe("не читается 9 ч");
    expect(signals[0].detail).toContain("1,74");
  });

  it("сеть без долга молчать имеет право", () => {
    const inp = input({
      debt: debt([
        chain({
          checkedAt: hoursAgo(9),
          healthFactor: null,
          totalDebtUsd: 0,
          totalCollateralUsd: 0,
          items: [],
        }),
      ]),
    });
    expect(kinds(inp)).toEqual([]);
  });

  it("долг ни разу не прочитан при заведённых кошельках", () => {
    const inp = input({
      debt: debt([], { totalDebtUsd: null, minHealthFactor: null }),
    });
    expect(kinds(inp)).toEqual(["debt-unread"]);
  });

  it("без кошельков «долг не прочитан» — не сигнал, а честный ноль", () => {
    const inp = input({
      portfolio: portfolio({ wallets: [] }),
      debt: debt([], { totalDebtUsd: null, minHealthFactor: null }),
    });
    expect(kinds(inp)).toEqual([]);
  });

  it("ошибка запроса долга — уровень ликвидации, а не гигиены", () => {
    const inp = input({
      debt: null,
      runtime: {
        debtError: "Сервер недоступен",
        zonesError: null,
        refreshError: null,
        chainIssues: [],
      },
    });
    const signals = buildSignals(inp, NOW);
    expect(signals.map((s) => s.kind)).toEqual(["debt-unavailable"]);
    expect(signals[0].severity).toBe("liquidation");
  });

  it("долг ещё грузится — не сигнал, а pending", () => {
    const inp = input({
      debt: null,
      pending: { portfolio: false, debt: true, zones: false, acks: false },
    });
    expect(kinds(inp)).toEqual([]);
    expect(hasPendingSources(inp)).toBe(true);
  });
});

// --- GM ------------------------------------------------------------------

describe("уровни GM", () => {
  it("показывается только самый глубокий уровень, а не все пройденные", () => {
    const signals = buildSignals(
      input({ positions: [gm({ priceUsd: 84_000 })] }),
      NOW,
    );
    expect(signals.map((s) => s.kind)).toEqual(["gm-level"]);
    expect(signals[0].chip).toBe("−15%");
  });

  it("цена выше всех уровней — уровня нет", () => {
    expect(kinds(input({ positions: [gm({ priceUsd: 99_000 })] }))).toEqual([]);
  });

  it("без точки отсчёта уровней нет, но молчания тоже нет", () => {
    const inp = input({ positions: [gm({ entryPriceUsd: null, priceUsd: 50_000 })] });
    expect(kinds(inp)).toEqual(["gm-no-entry"]);
  });

  it("без цены оракула уровни не выдумываются", () => {
    const inp = input({ positions: [gm({ priceUsd: null })] });
    expect(kinds(inp)).toEqual(["gm-no-price"]);
  });

  it("ориентир роста стоит ниже любого уровня падения", () => {
    // Доли 70/30 — ровно рабочий сплит, чтобы перекос не мешал порядку
    const inp = input({
      positions: [
        gm({
          id: "up",
          symbol: "ETH",
          entryPriceUsd: 3_000,
          priceUsd: 4_650,
          valueUsd: 30_000,
        }),
        gm({ id: "down", priceUsd: 92_000, valueUsd: 70_000 }),
      ],
    });
    expect(kinds(inp)).toEqual(["gm-level", "gm-growth"]);
  });

  it("на −30% деталь называет и действие GM, и действие Stability", () => {
    const signals = buildSignals(
      input({ positions: [gm({ priceUsd: 70_000 })] }),
      NOW,
    );
    expect(signals[0].detail).toContain("GM продают");
    expect(signals[0].detail).toContain("Stability");
  });

  it("перекос сплита больше пяти пунктов — сигнал плеча", () => {
    const inp = input({
      positions: [
        gm({ id: "btc", valueUsd: 78_400, priceUsd: 99_000 }),
        gm({ id: "eth", valueUsd: 21_600, priceUsd: 99_000, symbol: "ETH" }),
      ],
    });
    const split = buildSignals(inp, NOW).filter((s) => s.kind === "gm-split");
    expect(split).toHaveLength(2);
    expect(split[0].chip).toBe("+8,40%");
  });

  it("перекос в пределах допуска сигналом не становится", () => {
    const inp = input({
      positions: [
        gm({ id: "btc", valueUsd: 73_000, priceUsd: 99_000 }),
        gm({ id: "eth", valueUsd: 27_000, priceUsd: 99_000, symbol: "ETH" }),
      ],
    });
    expect(kinds(inp)).toEqual([]);
  });
});

// --- CLMM ----------------------------------------------------------------

describe("правило 48 часов", () => {
  it("срок идёт — сигнал говорит, сколько ждать", () => {
    const signals = buildSignals(
      input({ positions: [lp({ outOfRangeSince: hoursAgo(25) })] }),
      NOW,
    );
    expect(signals.map((s) => s.kind)).toEqual(["clmm-waiting"]);
    expect(signals[0].chip).toBe("ждать 23 ч");
    expect(signals[0].tone).toBe("neutral");
  });

  it("срок вышел — деталь называет сторону выхода", () => {
    const down = buildSignals(
      input({ positions: [lp({ outOfRangeSince: hoursAgo(51) })] }),
      NOW,
    );
    expect(down[0].kind).toBe("clmm-ready");
    expect(down[0].detail).toContain("Growth");

    const up = buildSignals(
      input({ positions: [lp({ outOfRangeSince: hoursAgo(51), held: "USDC" })] }),
      NOW,
    );
    expect(up[0].detail).toContain("перезаливают");
  });

  it("срок, выпавший на выходные, ждёт понедельника", () => {
    // Выход в четверг 10:00 → 48 часов истекают в субботу
    const saturdayNow = Date.parse("2026-08-08T12:00:00.000Z");
    const signals = buildSignals(
      input({
        debt: null,
        positions: [lp({ outOfRangeSince: "2026-08-06T10:00:00.000Z" })],
      }),
      saturdayNow,
    );
    expect(signals[0].kind).toBe("clmm-waiting");
    expect(signals[0].detail).toContain("понедельник");
  });

  it("позиция в диапазоне сигналом не становится", () => {
    expect(kinds(input({ positions: [lp({ inRange: true })] }))).toEqual([]);
  });

  it("момент выхода не записан — сказано прямо", () => {
    const inp = input({ positions: [lp({ outOfRangeSince: null })] });
    expect(kinds(inp)).toEqual(["clmm-unknown-since"]);
  });
});

// --- плечо и ставки ------------------------------------------------------

describe("плечо и ставки", () => {
  it("LTV выше цели — сумма, на которую долг больше целевого", () => {
    const inp = input({
      debt: debt([chain({ totalCollateralUsd: 110_000, totalDebtUsd: 64_200 })]),
    });
    const signals = buildSignals(inp, NOW);
    expect(signals.map((s) => s.kind)).toEqual(["ltv-off-target"]);
    expect(signals[0].title).toContain("выше цели");
    expect(signals[0].detail).toContain("$9 200");
  });

  it("LTV в коридоре пяти пунктов сигналом не становится", () => {
    const inp = input({
      debt: debt([chain({ totalCollateralUsd: 100_000, totalDebtUsd: 50_400 })]),
    });
    expect(kinds(inp)).toEqual([]);
  });

  it("LTV ниже цели — нейтральный тон и деньги, которые можно занять", () => {
    const inp = input({
      debt: debt([chain({ totalCollateralUsd: 100_000, totalDebtUsd: 44_000 })]),
    });
    const signals = buildSignals(inp, NOW);
    expect(signals[0].tone).toBe("neutral");
    expect(signals[0].title).toContain("ниже цели");
  });

  it("при HF в опасной зоне отклонение LTV подавлено", () => {
    const inp = input({
      debt: debt([
        chain({
          totalCollateralUsd: 100_000,
          totalDebtUsd: 70_000,
          healthFactor: 1.28,
        }),
      ]),
    });
    expect(kinds(inp)).toEqual(["hf-below"]);
  });

  it("залог одной сети неизвестен — LTV по части залога не считается", () => {
    const inp = input({
      debt: debt([
        chain({ totalCollateralUsd: null, totalDebtUsd: 70_000 }),
        chain({ chain: "base", totalCollateralUsd: 10_000, totalDebtUsd: 0 }),
      ]),
    });
    expect(kinds(inp)).not.toContain("ltv-off-target");
  });

  it("ставка депозита ниже ставки займа — сигнал с обоими числами", () => {
    const inp = input({
      positions: [fluid({ supplyRatePercent: 4.48 })],
      stableBorrowRatePercent: 4.9,
    });
    const signals = buildSignals(inp, NOW);
    expect(signals.map((s) => s.kind)).toEqual(["rate-below-borrow"]);
    expect(signals[0].title).toContain("4,48%");
    expect(signals[0].title).toContain("4,90%");
    expect(signals[0].chip).toBe("−0,42%");
  });

  it("депозит дороже займа сигналом не становится", () => {
    const inp = input({
      positions: [fluid({ supplyRatePercent: 6.1 })],
      stableBorrowRatePercent: 4.9,
    });
    expect(kinds(inp)).toEqual([]);
  });

  it("правило §3 не распространяется на нестейбл-депозиты", () => {
    const inp = input({
      positions: [fluid({ supplyRatePercent: 1.2, symbol: "WETH" })],
      stableBorrowRatePercent: 4.9,
    });
    expect(kinds(inp)).toEqual([]);
  });

  it("ставка займа не прочитана — сравнивать не с чем, и это сказано", () => {
    const inp = input({
      positions: [fluid()],
      stableBorrowRatePercent: null,
    });
    expect(kinds(inp)).toEqual(["borrow-rate-unread"]);
  });
});

// --- гигиена -------------------------------------------------------------

describe("гигиена данных", () => {
  it("счётные подписи склоняются", () => {
    const many = buildSignals(input({ zones: zones({ unmarkedPositions: 3 }) }), NOW);
    expect(many[0].title).toBe("3 позиции без разметки");
    const one = buildSignals(input({ zones: zones({ unmarkedPositions: 1 }) }), NOW);
    expect(one[0].title).toBe("1 позиция без разметки");
  });

  it("расхождение зон с активами названо суммой", () => {
    const inp = input({ zones: zones({ totalUsd: 151_240 }), assetsUsd: 150_000 });
    const signals = buildSignals(inp, NOW);
    expect(signals.map((s) => s.kind)).toEqual(["zones-mismatch"]);
    expect(signals[0].title).toContain("$1 240");
  });

  it("копеечное расхождение — дрожание цен, а не сигнал", () => {
    const inp = input({ zones: zones({ totalUsd: 150_000.3 }), assetsUsd: 150_000 });
    expect(kinds(inp)).toEqual([]);
  });

  it("одна сеть в двух источниках даёт одну строку", () => {
    const inp = input({
      portfolio: portfolio({
        chains: [
          { chain: "arbitrum", ok: false, error: "таймаут", checkedAt: hoursAgo(1) },
        ],
      }),
      runtime: {
        debtError: null,
        zonesError: null,
        refreshError: null,
        chainIssues: [{ chain: "arbitrum", message: "нет ответа" }],
      },
    });
    const signals = buildSignals(inp, NOW);
    expect(signals.map((s) => s.kind)).toEqual(["chains-unread"]);
    // Ответ refresh свежее статусов в кэше
    expect(signals[0].detail).toBe("Arbitrum: нет ответа");
  });

  it("две сети считаются числом", () => {
    const inp = input({
      runtime: {
        debtError: null,
        zonesError: null,
        refreshError: null,
        chainIssues: [
          { chain: "arbitrum", message: "таймаут" },
          { chain: "base", message: "нет ответа" },
        ],
      },
    });
    expect(buildSignals(inp, NOW)[0].title).toBe("2 сети не прочитаны");
  });

  it("устаревшие цены и неудавшееся обновление названы", () => {
    const inp = input({
      portfolio: portfolio({
        freshness: {
          oldestPriceAt: hoursAgo(7),
          oldestCollateralAt: hoursAgo(7),
          anyPriceStale: true,
        },
      }),
      runtime: {
        debtError: null,
        zonesError: null,
        refreshError: "Не удалось обновить данные",
        chainIssues: [],
      },
    });
    expect(kinds(inp).sort()).toEqual(["prices-stale", "refresh-failed"]);
  });
});

// --- пустота и чистота ---------------------------------------------------

describe("пустая лента", () => {
  it("всё спокойно и всё прочитано — пусто и без pending", () => {
    const inp = input();
    expect(buildSignals(inp, NOW)).toEqual([]);
    expect(hasPendingSources(inp)).toBe(false);
  });

  it("спокойно, но зоны ещё читаются — пусто и с pending", () => {
    const inp = input({
      positions: null,
      zones: null,
      pending: { portfolio: false, debt: false, zones: true, acks: false },
    });
    expect(buildSignals(inp, NOW)).toEqual([]);
    expect(hasPendingSources(inp)).toBe(true);
  });

  it("модуль не ходит в Date.now(): один nowMs — один результат", () => {
    const inp = input({
      positions: [lp({ outOfRangeSince: hoursAgo(25) })],
    });
    expect(buildSignals(inp, NOW)).toEqual(buildSignals(inp, NOW));
  });
});

// --- отметки «выполнено» -------------------------------------------------

describe("отметка «выполнено»", () => {
  /** Ключ и отпечаток отметки для сигнала, который сейчас в ленте. */
  function ackFor(inp: SignalsInput, kind: SignalKind) {
    const signal = buildSignals(inp, NOW).find((s) => s.kind === kind);
    if (!signal?.ackKey || !signal.ackFingerprint) {
      throw new Error(`сигнал ${kind} не отмечается`);
    }
    return { signalKey: signal.ackKey, fingerprint: signal.ackFingerprint };
  }

  it("отмеченный уровень уходит из активных, но не пропадает совсем", () => {
    const base = input({ positions: [gm({ priceUsd: 84_000 })] });
    const acked = input({
      positions: [gm({ priceUsd: 84_000 })],
      acks: [ackFor(base, "gm-level")],
    });

    const all = buildSignals(acked, NOW);
    expect(activeSignals(all)).toEqual([]);
    expect(ackedSignals(all).map((s) => s.kind)).toEqual(["gm-level"]);
  });

  it("следующий уровень отметку не наследует: у него свой ключ", () => {
    const base = input({ positions: [gm({ priceUsd: 84_000 })] }); // −16%
    const deeper = input({
      positions: [gm({ priceUsd: 68_000 })], // −32%
      acks: [ackFor(base, "gm-level")],
    });
    expect(kinds(deeper)).toEqual(["gm-level"]);
  });

  it("перенос точки отсчёта отменяет отметку: уровни считаются заново", () => {
    const base = input({ positions: [gm({ priceUsd: 84_000 })] });
    const moved = input({
      // Точку отсчёта перенесли выше — тот же уровень, другое решение
      positions: [gm({ entryPriceUsd: 120_000, priceUsd: 84_000 })],
      acks: [ackFor(base, "gm-level")],
    });
    expect(kinds(moved)).toContain("gm-level");
  });

  it("новый выход из диапазона отменяет отметку CLMM", () => {
    const base = input({
      positions: [lp({ outOfRangeSince: hoursAgo(51) })],
    });
    const same = input({
      positions: [lp({ outOfRangeSince: hoursAgo(51) })],
      acks: [ackFor(base, "clmm-ready")],
    });
    expect(kinds(same)).toEqual([]);

    const again = input({
      // Вернулась в диапазон и вышла снова — другое ожидание
      positions: [lp({ outOfRangeSince: hoursAgo(49) })],
      acks: [ackFor(base, "clmm-ready")],
    });
    expect(kinds(again)).toEqual(["clmm-ready"]);
  });

  it("риск ликвидации и гигиена не отмечаются вовсе", () => {
    const inp = input({
      debt: debt([chain({ healthFactor: 1.42 })]),
      zones: zones({ unmarkedPositions: 2 }),
    });
    for (const signal of buildSignals(inp, NOW)) {
      expect(signal.ackKey).toBeNull();
    }
  });

  it("отметка на чужой ключ ничего не скрывает", () => {
    const inp = input({
      positions: [gm({ priceUsd: 84_000 })],
      acks: [{ signalKey: "gm-level:другой:15", fingerprint: "100000" }],
    });
    expect(kinds(inp)).toEqual(["gm-level"]);
  });

  it("пока отметки не прочитаны, лента считается неполной", () => {
    const inp = input({
      acks: null,
      pending: { portfolio: false, debt: false, zones: false, acks: true },
    });
    expect(hasPendingSources(inp)).toBe(true);
  });
});
