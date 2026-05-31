import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  aggregateSessionGainsForAccounts,
  computePeriodResult,
  resolvePeriodBounds,
  sumSessionGainsInRange,
} from "./performance-indicator-logic";
import type { PerformanceIndicatorPayload } from "./performance-indicator-types";

function mockPayload(
  overrides: Partial<PerformanceIndicatorPayload> = {},
): PerformanceIndicatorPayload {
  const sessionGainsByAccount = overrides.sessionGainsByAccount ?? {
    "ACC|CAD": [
      { date: "2026-05-26", gainCad: 1_000, priorCad: 90_000 },
      { date: "2026-05-27", gainCad: 2_000, priorCad: 91_000 },
    ],
    "ACC2|CAD": [
      { date: "2026-05-26", gainCad: 500, priorCad: 40_000 },
      { date: "2026-05-27", gainCad: 300, priorCad: 40_500 },
    ],
  };

  const sessionGainsByDate = Object.values(sessionGainsByAccount)
    .flat()
    .reduce((map, g) => {
      const bucket = map.get(g.date) ?? { gainCad: 0, priorCad: 0 };
      bucket.gainCad += g.gainCad;
      bucket.priorCad += g.priorCad;
      return map;
    }, new Map<string, { gainCad: number; priorCad: number }>());

  return {
    accounts: [
      {
        accountKey: "ACC|CAD",
        label: "Test A",
        owner: "Alice",
        accountType: null,
        currency: "CAD",
        isExternal: false,
      },
      {
        accountKey: "ACC2|CAD",
        label: "Test B",
        owner: "Bob",
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
      "ACC2|CAD": {
        totalCad: 50_000,
        positionsCad: 50_000,
        cashCad: 0,
        dayGainCad: 200,
        dayPriorCad: 49_800,
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
    sessionGainsByDate: [...sessionGainsByDate.entries()].map(([date, v]) => ({
      date,
      gainCad: v.gainCad,
      priorCad: v.priorCad,
    })),
    sessionGainsByAccount,
    sessionDataHealth: {
      ok: true,
      message: null,
      persistedDays: 2,
      firstDate: "2026-05-26",
      lastDate: "2026-05-27",
    },
    cashFlows: [],
    holdings: [],
    enrichedHoldings: [],
    dailyCloses: {},
    usdToCad: 1.35,
    usdToCadDate: "2026-05-27",
    availableYears: [2026],
    quotesAsOf: null,
    asOfNow: "2026-05-28T15:00:00",
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
  test("1 mois : glissant sur ~1 mois calendaire", () => {
    const ref = new Date(2026, 4, 29, 12, 0, 0);
    const bounds = resolvePeriodBounds("month", ref, 2026, null);
    assert.equal(bounds.end, "2026-05-29");
    assert.equal(bounds.start, "2026-04-29");
  });

  test("1 an : glissant sur 12 mois", () => {
    const ref = new Date(2026, 4, 29, 12, 0, 0);
    const bounds = resolvePeriodBounds("year", ref, 2026, null);
    assert.equal(bounds.end, "2026-05-29");
    assert.equal(bounds.start, "2025-05-29");
  });
});

describe("aggregateSessionGainsForAccounts", () => {
  test("filtre par compte", () => {
    const payload = mockPayload();
    const all = aggregateSessionGainsForAccounts(payload, ["ACC|CAD", "ACC2|CAD"]);
    const one = aggregateSessionGainsForAccounts(payload, ["ACC|CAD"]);
    assert.equal(all.find((g) => g.date === "2026-05-26")?.gainCad, 1500);
    assert.equal(one.find((g) => g.date === "2026-05-26")?.gainCad, 1000);
  });
});

describe("computePeriodResult", () => {
  test("filtre propriétaire change le rendement 1 mois", () => {
    const payload = mockPayload({
      sessionGainsByAccount: {
        "ACC|CAD": [
          { date: "2026-04-29", gainCad: 10_000, priorCad: 80_000 },
          { date: "2026-05-29", gainCad: 1_000, priorCad: 90_000 },
        ],
        "ACC2|CAD": [
          { date: "2026-04-29", gainCad: 100, priorCad: 40_000 },
          { date: "2026-05-29", gainCad: 50, priorCad: 40_100 },
        ],
      },
      asOfNow: "2026-05-29T22:00:00",
      currentByAccount: {
        "ACC|CAD": {
          totalCad: 91_000,
          positionsCad: 91_000,
          cashCad: 0,
          dayGainCad: 1_000,
          dayPriorCad: 90_000,
        },
        "ACC2|CAD": {
          totalCad: 40_150,
          positionsCad: 40_150,
          cashCad: 0,
          dayGainCad: 50,
          dayPriorCad: 40_100,
        },
      },
    });

    const all = computePeriodResult(
      payload,
      {
        preset: "disnat",
        owner: null,
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "month",
    );
    const alice = computePeriodResult(
      payload,
      {
        preset: "disnat",
        owner: "Alice",
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "month",
    );

    assert.notEqual(all.gainCad, alice.gainCad);
    assert.ok((alice.gainCad ?? 0) < (all.gainCad ?? 0));
  });

  test("sans séances persistées → indisponible", () => {
    const payload = mockPayload({
      sessionGainsByDate: [],
      sessionGainsByAccount: {},
    });
    const month = computePeriodResult(
      payload,
      {
        preset: "disnat",
        owner: null,
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "month",
    );
    assert.equal(month.method, "unavailable");
    assert.equal(month.gainCad, null);
  });
});
