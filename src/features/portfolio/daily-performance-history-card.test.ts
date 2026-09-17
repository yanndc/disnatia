import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildDailyPerformanceRows } from "./daily-performance-history-card";
import type { PerformanceIndicatorPayload } from "./performance-indicator-types";

function mockPayload(
  sessionGainsByAccount: PerformanceIndicatorPayload["sessionGainsByAccount"],
): PerformanceIndicatorPayload {
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
    ],
    currentByAccount: {},
    snapshots: [],
    historyPoints: [],
    dailyTotalsCad: [],
    sessionGainsByDate: [],
    sessionGainsByAccount,
    sessionDataHealth: {
      ok: true,
      message: null,
      persistedDays: Object.values(sessionGainsByAccount).flat().length,
      firstDate: null,
      lastDate: null,
    },
    performanceSnapshots: null,
    cashFlows: [],
    accountCashLedgers: {},
    holdings: [],
    enrichedHoldings: [],
    dailyCloses: {},
    usdToCad: null,
    usdToCadDate: null,
    usdCadRateByDate: {},
    availableYears: [2026],
    quotesAsOf: null,
    asOfNow: "2026-05-28T15:00:00",
  };
}

describe("buildDailyPerformanceRows", () => {
  test("calcule le % du jour et le cumul composé sur les séances filtrées", () => {
    const payload = mockPayload({
      "ACC|CAD": [
        { date: "2026-05-25", gainCad: 1_000, priorCad: 100_000 },
        { date: "2026-05-26", gainCad: -500, priorCad: 101_000 },
      ],
    });

    const rows = buildDailyPerformanceRows(payload, ["ACC|CAD"]);

    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.gainCad, 1_000);
    assert.equal(rows[0]!.gainPct, 1);
    assert.ok(Math.abs(rows[0]!.cumulativePct - 1) < 1e-9);

    assert.equal(rows[1]!.gainCad, -500);
    assert.ok(Math.abs(rows[1]!.gainPct! - (-500 / 101_000) * 100) < 1e-9);
    // cumul composé : (1.01) * (1 - 500/101000) - 1
    const expectedCumulative = (1.01 * (1 - 500 / 101_000) - 1) * 100;
    assert.ok(Math.abs(rows[1]!.cumulativePct - expectedCumulative) < 1e-9);
  });

  test("gère priorCad = 0 sans casser le calcul (% null, cumul inchangé)", () => {
    const payload = mockPayload({
      "ACC|CAD": [{ date: "2026-05-25", gainCad: 200, priorCad: 0 }],
    });

    const rows = buildDailyPerformanceRows(payload, ["ACC|CAD"]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.gainPct, null);
    assert.equal(rows[0]!.cumulativePct, 0);
  });

  test("respecte la limite de séances affichées (daysShown)", () => {
    const sessions = Array.from({ length: 15 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, "0")}`,
      gainCad: 10,
      priorCad: 1_000,
    }));
    const payload = mockPayload({ "ACC|CAD": sessions });

    const rows = buildDailyPerformanceRows(payload, ["ACC|CAD"], 10);

    assert.equal(rows.length, 10);
    assert.equal(rows[0]!.date, "2026-05-06");
    assert.equal(rows[9]!.date, "2026-05-15");
  });

  test("filtre par compte comme aggregateSessionGainsForAccounts", () => {
    const payload = mockPayload({
      "ACC|CAD": [{ date: "2026-05-25", gainCad: 100, priorCad: 10_000 }],
      "ACC2|CAD": [{ date: "2026-05-25", gainCad: 900, priorCad: 90_000 }],
    });

    const scoped = buildDailyPerformanceRows(payload, ["ACC|CAD"]);
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0]!.gainCad, 100);
  });
});
