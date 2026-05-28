import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computePeriodResult,
  resolvePeriodBounds,
  sumSessionGainsInRange,
} from "./performance-indicator-logic";
import type { PerformanceIndicatorPayload } from "./performance-indicator-types";

function mockPayload(
  overrides: Partial<PerformanceIndicatorPayload> = {},
): PerformanceIndicatorPayload {
  return {
    accounts: [
      {
        accountKey: "ACC|CAD",
        label: "Test",
        owner: null,
        accountType: null,
        currency: "CAD",
        isExternal: false,
      },
    ],
    currentByAccount: {
      "ACC|CAD": {
        totalCad: 100_000,
        positionsCad: 100_000,
        cashCad: 0,
        dayGainCad: 500,
        dayPriorCad: 99_500,
      },
    },
    snapshots: [],
    historyPoints: [
      {
        accountKey: "ACC|CAD",
        asOf: "2026-05-22",
        totalValueNative: 90_000,
        currency: "CAD",
      },
    ],
    dailyTotalsCad: [],
    sessionGainsByDate: [
      { date: "2026-05-26", gainCad: 1_000, priorCad: 90_000 },
      { date: "2026-05-27", gainCad: 2_000, priorCad: 91_000 },
    ],
    cashFlows: [],
    holdings: [],
    dailyCloses: {},
    usdToCad: 1.35,
    usdToCadDate: "2026-05-27",
    availableYears: [2026],
    quotesAsOf: null,
    asOfNow: "2026-05-28",
    ...overrides,
  };
}

describe("sumSessionGainsInRange", () => {
  test("somme les séances dans la plage", () => {
    const sessions = [
      { date: "2026-05-26", gainCad: 1000, priorCad: 90_000 },
      { date: "2026-05-27", gainCad: 2000, priorCad: 91_000 },
      { date: "2026-05-28", gainCad: 500, priorCad: 93_000 },
    ];
    const hit = sumSessionGainsInRange(sessions, "2026-05-26", "2026-05-27");
    assert.equal(hit.gainCad, 3000);
    assert.equal(hit.priorCad, 90_000);
    assert.deepEqual(hit.dates, ["2026-05-26", "2026-05-27"]);
  });
});

describe("resolvePeriodBounds", () => {
  test("semaine : baseline = veille ouvrée avant lundi", () => {
    const wed = new Date(2026, 4, 27, 12, 0, 0);
    const bounds = resolvePeriodBounds("week", wed, 2026, null);
    assert.equal(bounds.start, "2026-05-25");
    assert.equal(bounds.baselineLookup, "2026-05-22");
  });

  test("hier : séance précédente vs baseline", () => {
    const thu = new Date(2026, 4, 28, 12, 0, 0);
    const bounds = resolvePeriodBounds("yesterday", thu, 2026, null);
    assert.equal(bounds.end, "2026-05-27");
    assert.equal(bounds.baselineLookup, "2026-05-26");
  });
});

describe("computePeriodResult", () => {
  test("hier ≠ jour quand les séances diffèrent", () => {
    const payload = mockPayload({
      sessionGainsByDate: [
        { date: "2026-05-27", gainCad: 2_000, priorCad: 91_000 },
      ],
      currentByAccount: {
        "ACC|CAD": {
          totalCad: 100_000,
          positionsCad: 100_000,
          cashCad: 0,
          dayGainCad: 500,
          dayPriorCad: 99_500,
        },
      },
    });
    const filters = {
      preset: "disnat" as const,
      owner: null,
      includedAccountKeys: [],
      excludedAccountKeys: [],
      selectedYear: 2026,
    };
    const day = computePeriodResult(payload, filters, "day");
    const yesterday = computePeriodResult(payload, filters, "yesterday");
    assert.equal(yesterday.gainCad, 2000);
    assert.equal(day.gainCad, 500);
    assert.notEqual(day.gainCad, yesterday.gainCad);
  });

  test("semaine inclut le live du jour si séance en cours", () => {
    const payload = mockPayload();
    const filters = {
      preset: "disnat" as const,
      owner: null,
      includedAccountKeys: [],
      excludedAccountKeys: [],
      selectedYear: 2026,
    };
    const week = computePeriodResult(payload, filters, "week");
    assert.equal(week.method, "session-chain");
    assert.equal(week.gainCad, 1000 + 2000 + 500);
  });

  test("semaine sans live si séance déjà dans l'historique", () => {
    const payload = mockPayload({
      sessionGainsByDate: [
        { date: "2026-05-26", gainCad: 1000, priorCad: 90_000 },
        { date: "2026-05-27", gainCad: 2000, priorCad: 91_000 },
        { date: "2026-05-28", gainCad: 500, priorCad: 93_000 },
      ],
    });
    const filters = {
      preset: "disnat" as const,
      owner: null,
      includedAccountKeys: [],
      excludedAccountKeys: [],
      selectedYear: 2026,
    };
    const week = computePeriodResult(payload, filters, "week");
    assert.equal(week.gainCad, 3500);
  });
});
