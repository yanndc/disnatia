import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeAllPeriodResultsWithSnapshots,
  computePeriodResult,
} from "./performance-indicator-logic";
import type { PerformanceIndicatorPayload } from "./performance-indicator-types";
import { PERFORMANCE_CALC_VERSION } from "./performance-calc-version";
import {
  performanceScopeKey,
  standardPerformanceScopeFilters,
} from "./performance-snapshot-scope";

function miniPayload(): PerformanceIndicatorPayload {
  return {
    accounts: [
      {
        accountKey: "ACC|CAD",
        label: "A",
        owner: "Alice",
        accountType: null,
        currency: "CAD",
        isExternal: false,
      },
    ],
    currentByAccount: {
      "ACC|CAD": {
        totalCad: 101_000,
        positionsCad: 101_000,
        cashCad: 0,
        dayGainCad: 500,
        dayPriorCad: 100_500,
      },
    },
    snapshots: [],
    historyPoints: [],
    dailyTotalsCad: [],
    sessionGainsByDate: [{ date: "2026-05-27", gainCad: 1_000, priorCad: 100_000 }],
    sessionGainsByAccount: {
      "ACC|CAD": [{ date: "2026-05-27", gainCad: 1_000, priorCad: 100_000 }],
    },
    sessionDataHealth: {
      ok: true,
      message: null,
      persistedDays: 1,
      firstDate: "2026-05-27",
      lastDate: "2026-05-27",
    },
    performanceSnapshots: null,
    cashFlows: [],
    accountCashLedgers: {},
    holdings: [],
    enrichedHoldings: [],
    dailyCloses: {},
    usdToCad: 1.4,
    usdToCadDate: "2026-05-27",
    usdCadRateByDate: {},
    availableYears: [2026],
    quotesAsOf: "2026-05-28T20:00:00.000Z",
    asOfNow: "2026-05-28T15:00:00",
  };
}

describe("performanceScopeKey", () => {
  test("stable pour même portée", () => {
    const a = performanceScopeKey({
      preset: "all",
      owner: "Alice",
      includedAccountKeys: ["b", "a"],
      excludedAccountKeys: [],
    });
    const b = performanceScopeKey({
      preset: "all",
      owner: "Alice",
      includedAccountKeys: ["a", "b"],
      excludedAccountKeys: [],
    });
    assert.equal(a, b);
  });
});

describe("computeAllPeriodResultsWithSnapshots", () => {
  test("recalcule en live (ignore les snapshots persistés)", () => {
    const payload = miniPayload();
    const scope = standardPerformanceScopeFilters(payload)[0]!;
    const key = performanceScopeKey(scope);
    const snapMonth = {
      periodId: "month" as const,
      label: "1 mois",
      shortLabel: "1 mois",
      gainCad: 42,
      gainPct: 4.2,
      currentCad: 101_000,
      baselineCad: 100_000,
      baselineDate: "2026-04-28",
      periodStart: "2026-04-28",
      periodEnd: "2026-05-28",
      method: "session-chain" as const,
      accountsIncluded: 1,
      accountsWithBaseline: 1,
      incomplete: false,
      annualized: false,
      note: null,
    };
    payload.performanceSnapshots = {
      calcVersion: PERFORMANCE_CALC_VERSION,
      sessionDate: "2026-05-28",
      byScopeKey: { [key]: [snapMonth] },
    };

    const filters = { ...scope, activePeriod: "month" as const };
    const results = computeAllPeriodResultsWithSnapshots(payload, filters);
    const month = results.find((r) => r.periodId === "month");
    const day = results.find((r) => r.periodId === "day");
    const liveMonth = computePeriodResult(payload, filters, "month");
    assert.equal(month?.gainCad, liveMonth.gainCad);
    assert.notEqual(month?.gainCad, 42);
    assert.notEqual(day?.method, "unavailable");
  });
});
