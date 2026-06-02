import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  aggregateSessionGainsForAccounts,
  computePeriodResult,
  resolvePeriodBounds,
  resolveSessionChainGainPct,
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

describe("resolveSessionChainGainPct", () => {
  test("1 séance → prior de la séance", () => {
    const hit = resolveSessionChainGainPct(1_000, 90_000, 91_000, 1);
    assert.equal(hit.baselineCad, 90_000);
    assert.ok(Math.abs((hit.gainPct ?? 0) - (1000 / 90_000) * 100) < 0.01);
  });

  test("plusieurs séances → baseline implicite (fin − gains)", () => {
    const gainCad = 94_807;
    const positionsCadNow = 237_900;
    const hit = resolveSessionChainGainPct(gainCad, 1_130, positionsCadNow, 400);
    const expectedBaseline = positionsCadNow - gainCad;
    assert.equal(hit.baselineCad, expectedBaseline);
    assert.ok(Math.abs((hit.gainPct ?? 0) - (gainCad / expectedBaseline) * 100) < 0.01);
    assert.ok((hit.gainPct ?? 0) < 100, "ne doit pas exploser à des milliers de %");
  });
});

describe("computePeriodResult", () => {
  test("depuis le début : % cohérent malgré 1re séance à couverture partielle", () => {
    const sessionGainsByAccount = {
      "ACC|CAD": [
        { date: "2022-03-23", gainCad: -1.14, priorCad: 1_130.52 },
        { date: "2022-04-01", gainCad: 200, priorCad: 38_534 },
        { date: "2026-05-29", gainCad: 500, priorCad: 236_899 },
      ],
    };
    const totalGain = sessionGainsByAccount["ACC|CAD"]!.reduce(
      (s, g) => s + g.gainCad,
      0,
    );
    const positionsCad = 237_400;
    const payload = mockPayload({
      sessionGainsByAccount,
      asOfNow: "2026-05-29T22:00:00",
      currentByAccount: {
        "ACC|CAD": {
          totalCad: positionsCad,
          positionsCad,
          cashCad: 0,
          dayGainCad: 500,
          dayPriorCad: 236_899,
        },
        "ACC2|CAD": {
          totalCad: 0,
          positionsCad: 0,
          cashCad: 0,
          dayGainCad: null,
          dayPriorCad: null,
        },
      },
    });

    const all = computePeriodResult(
      payload,
      {
        preset: "disnat",
        owner: null,
        includedAccountKeys: [],
        excludedAccountKeys: ["ACC2|CAD"],
        selectedYear: 2026,
      },
      "all",
    );

    const expectedPct = (totalGain / (positionsCad - totalGain)) * 100;
    assert.ok(Math.abs((all.gainPct ?? 0) - expectedPct) < 0.05);
    assert.ok((all.gainPct ?? 0) < 200);
    assert.notEqual(all.baselineCad, 1_130.52);
  });

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

  test("depuis le début : pas d alerte si 1re séance après le plus ancien import", () => {
    const payload = mockPayload({
      snapshots: [
        {
          accountKey: "ACC|CAD",
          asOf: "2022-03-21",
          totalValueNative: 50_000,
          currency: "CAD",
        },
      ],
      sessionGainsByAccount: {
        "ACC|CAD": [{ date: "2022-06-02", gainCad: 100, priorCad: 50_000 }],
        "ACC2|CAD": [{ date: "2022-06-02", gainCad: 50, priorCad: 40_000 }],
      },
      asOfNow: "2026-05-29T22:00:00",
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
      "all",
    );
    assert.equal(all.incomplete, false);
    assert.equal(all.note, null);
    assert.equal(all.baselineDate, "2022-06-02");
  });

  test("AAJ : pas d alerte si 1re séance = 2 jan (1er jan férié)", () => {
    const payload = mockPayload({
      sessionGainsByAccount: {
        "ACC|CAD": [
          { date: "2026-01-02", gainCad: 1_000, priorCad: 200_000 },
          { date: "2026-06-02", gainCad: 500, priorCad: 240_000 },
        ],
        "ACC2|CAD": [
          { date: "2026-01-02", gainCad: 200, priorCad: 50_000 },
          { date: "2026-06-02", gainCad: 100, priorCad: 52_000 },
        ],
      },
      asOfNow: "2026-06-02T15:00:00",
    });
    const ytd = computePeriodResult(
      payload,
      {
        preset: "disnat",
        owner: null,
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "ytd",
    );
    assert.equal(ytd.incomplete, false);
    assert.equal(ytd.note, null);
    assert.equal(ytd.baselineDate, "2026-01-02");
  });

  test("AAJ : alerte si historique commence bien après le début d année", () => {
    const payload = mockPayload({
      sessionGainsByAccount: {
        "ACC|CAD": [{ date: "2026-03-03", gainCad: 1_000, priorCad: 200_000 }],
        "ACC2|CAD": [{ date: "2026-03-03", gainCad: 200, priorCad: 50_000 }],
      },
      asOfNow: "2026-06-02T15:00:00",
    });
    const ytd = computePeriodResult(
      payload,
      {
        preset: "disnat",
        owner: null,
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "ytd",
    );
    assert.equal(ytd.incomplete, true);
    assert.match(ytd.note ?? "", /historique de séances incomplet/);
  });
});
