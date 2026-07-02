import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildPerformanceCashFlowsFromTxRows } from "./performance-cash-flows";
import {
  aggregateSessionGainsForAccounts,
  computePeriodResult,
  computeTitresPeriodGain,
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
        asOf: "2026-04-28",
        totalValueNative: 80_000,
        currency: "CAD",
      },
      {
        accountKey: "ACC2|CAD",
        asOf: "2026-04-28",
        totalValueNative: 40_000,
        currency: "CAD",
      },
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
    performanceSnapshots: null,
    cashFlows: [],
    accountCashLedgers: {},
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
  test("1 mois : ~21 séances ouvrées glissantes", () => {
    const ref = new Date(2026, 4, 29, 12, 0, 0);
    const bounds = resolvePeriodBounds("month", ref, 2026, null);
    assert.equal(bounds.end, "2026-05-29");
    assert.equal(bounds.start, "2026-05-01");
  });

  test("1 an : glissant sur 12 mois", () => {
    const ref = new Date(2026, 4, 29, 12, 0, 0);
    const bounds = resolvePeriodBounds("year", ref, 2026, null);
    assert.equal(bounds.end, "2026-05-29");
    assert.equal(bounds.start, "2025-05-29");
  });

  test("séance précédente : veille de la séance de référence (pas la même date)", () => {
    const tueBeforeOpen = new Date("2026-06-02T08:10:00");
    const bounds = resolvePeriodBounds("yesterday", tueBeforeOpen, 2026, null);
    assert.equal(bounds.start, "2026-05-29");
    assert.equal(bounds.end, "2026-05-29");

    const sat = new Date("2026-06-13T12:00:00");
    const satBounds = resolvePeriodBounds("yesterday", sat, 2026, null);
    assert.equal(satBounds.start, "2026-06-11");
    assert.equal(satBounds.end, "2026-06-11");
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

  test("plusieurs séances → baseline implicite si couverture partielle", () => {
    const gainCad = 94_807;
    const positionsCadNow = 237_900;
    const hit = resolveSessionChainGainPct(gainCad, 1_130, positionsCadNow, 400);
    const expectedBaseline = positionsCadNow - gainCad;
    assert.equal(hit.baselineCad, expectedBaseline);
    assert.ok(Math.abs((hit.gainPct ?? 0) - (gainCad / expectedBaseline) * 100) < 0.01);
    assert.ok((hit.gainPct ?? 0) < 100, "ne doit pas exploser à des milliers de %");
  });

  test("plusieurs séances → baseline ajustée des flux nets", () => {
    const gainCad = 10_000;
    const firstPrior = 100_000;
    const positionsCadNow = 160_000;
    const netFlows = 50_000;
    const hit = resolveSessionChainGainPct(
      gainCad,
      firstPrior,
      positionsCadNow,
      200,
      netFlows,
    );
    assert.equal(hit.baselineCad, 150_000);
    assert.ok(Math.abs((hit.gainPct ?? 0) - (10_000 / 150_000) * 100) < 0.01);
  });
});

describe("computePeriodResult", () => {
  test("avant 9h30 : séance « — », précédente = séance d'avant la référence (pas la référence)", () => {
    const payload = mockPayload({
      sessionGainsByAccount: {
        "ACC|CAD": [
          { date: "2026-05-29", gainCad: 400, priorCad: 89_000 },
          { date: "2026-06-01", gainCad: 800, priorCad: 90_000 },
        ],
        "ACC2|CAD": [
          { date: "2026-05-29", gainCad: 300, priorCad: 39_000 },
          { date: "2026-06-01", gainCad: 700, priorCad: 40_000 },
        ],
      },
      sessionDataHealth: {
        ok: true,
        message: null,
        persistedDays: 2,
        firstDate: "2026-05-29",
        lastDate: "2026-06-01",
      },
      historyPoints: [
        {
          accountKey: "ACC|CAD",
          asOf: "2026-05-29",
          totalValueNative: 89_400,
          currency: "CAD",
        },
        {
          accountKey: "ACC|CAD",
          asOf: "2026-06-01",
          totalValueNative: 91_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC2|CAD",
          asOf: "2026-05-29",
          totalValueNative: 39_300,
          currency: "CAD",
        },
        {
          accountKey: "ACC2|CAD",
          asOf: "2026-06-01",
          totalValueNative: 40_500,
          currency: "CAD",
        },
      ],
      asOfNow: "2026-06-02T08:10:00",
      currentByAccount: {
        "ACC|CAD": {
          totalCad: 200_000,
          positionsCad: 200_000,
          cashCad: 0,
          dayGainCad: null,
          dayPriorCad: null,
        },
        "ACC2|CAD": {
          totalCad: 200_000,
          positionsCad: 200_000,
          cashCad: 0,
          dayGainCad: null,
          dayPriorCad: null,
        },
      },
    });

    const day = computePeriodResult(
      payload,
      {
        preset: "disnat",
        owner: null,
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "day",
    );
    const prec = computePeriodResult(
      payload,
      {
        preset: "disnat",
        owner: null,
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "yesterday",
    );

    assert.equal(day.gainCad, null);
    assert.equal(day.method, "unavailable");
    assert.ok((prec.gainCad ?? 0) > 0);
    assert.ok((prec.gainCad ?? 0) < 1_500, "vendredi, pas le lundi (référence)");
    assert.equal(prec.gainCad, 700);
    assert.notEqual(prec.gainCad, 1_500);
  });

  test("Préc. : complet malgré compte vide et historique figé 2024", () => {
    const payload = mockPayload({
      sessionGainsByAccount: {
        "ACC|CAD": [
          { date: "2026-06-01", gainCad: 1_000, priorCad: 90_000 },
          { date: "2026-06-02", gainCad: 500, priorCad: 91_000 },
        ],
        "STALE|CAD": [],
        "EMPTY|CAD": [],
      },
      sessionDataHealth: {
        ok: true,
        message: null,
        persistedDays: 2,
        firstDate: "2026-06-01",
        lastDate: "2026-06-02",
      },
      accounts: [
        {
          accountKey: "ACC|CAD",
          label: "Actif",
          owner: "Alice",
          accountType: null,
          currency: "CAD",
          isExternal: false,
        },
        {
          accountKey: "STALE|CAD",
          label: "Inactif",
          owner: "Alice",
          accountType: null,
          currency: "CAD",
          isExternal: false,
        },
        {
          accountKey: "EMPTY|CAD",
          label: "Vide",
          owner: "Alice",
          accountType: null,
          currency: "CAD",
          isExternal: false,
        },
      ],
      historyPoints: [
        {
          accountKey: "ACC|CAD",
          asOf: "2026-05-29",
          totalValueNative: 89_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC|CAD",
          asOf: "2026-06-01",
          totalValueNative: 91_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC|CAD",
          asOf: "2026-06-02",
          totalValueNative: 91_000,
          currency: "CAD",
        },
        {
          accountKey: "STALE|CAD",
          asOf: "2024-03-10",
          totalValueNative: 5_000,
          currency: "CAD",
        },
      ],
      asOfNow: "2026-06-03T08:10:00",
      currentByAccount: {
        "ACC|CAD": {
          totalCad: 91_000,
          positionsCad: 91_000,
          cashCad: 0,
          dayGainCad: null,
          dayPriorCad: null,
        },
        "STALE|CAD": {
          totalCad: 0,
          positionsCad: 0,
          cashCad: 0,
          dayGainCad: null,
          dayPriorCad: null,
        },
        "EMPTY|CAD": {
          totalCad: 0,
          positionsCad: 0,
          cashCad: 0,
          dayGainCad: null,
          dayPriorCad: null,
        },
      },
    });

    const prec = computePeriodResult(
      payload,
      {
        preset: "disnat",
        owner: null,
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "yesterday",
    );

    assert.equal(prec.incomplete, false);
    assert.equal(prec.note, null);
    assert.ok(Math.abs((prec.gainCad ?? 0) - 1_000) < 1);
  });

  test("depuis le début : gain = Σ séances, % via Dietz/TWR", () => {
    const positionsCad = 203_000;
    const payload = mockPayload({
      asOfNow: "2026-05-29T22:00:00",
      historyPoints: [
        {
          accountKey: "ACC|CAD",
          asOf: "2026-04-28",
          totalValueNative: 200_000,
          currency: "CAD",
        },
      ],
      currentByAccount: {
        "ACC|CAD": {
          totalCad: positionsCad,
          positionsCad,
          cashCad: 0,
          dayGainCad: 500,
          dayPriorCad: 202_500,
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

    assert.ok(Math.abs((all.gainCad ?? 0) - 3_000) < 1);
    assert.ok((all.gainPct ?? 0) > 0 && (all.gainPct ?? 0) < 10);
    assert.equal(all.annualized, false);
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

  test("sans historique titres → indisponible", () => {
    const payload = mockPayload({
      sessionGainsByDate: [],
      sessionGainsByAccount: {},
      historyPoints: [],
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

  test("depuis le début : pas d alerte, baseline Dietz = historique titres", () => {
    const payload = mockPayload({
      historyPoints: [
        {
          accountKey: "ACC|CAD",
          asOf: "2022-03-20",
          totalValueNative: 50_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC2|CAD",
          asOf: "2022-03-20",
          totalValueNative: 40_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC|CAD",
          asOf: "2026-05-29",
          totalValueNative: 91_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC2|CAD",
          asOf: "2026-05-29",
          totalValueNative: 40_500,
          currency: "CAD",
        },
      ],
      sessionGainsByAccount: {
        "ACC|CAD": [
          { date: "2022-03-21", gainCad: 100, priorCad: 50_000 },
          { date: "2026-05-27", gainCad: 2_000, priorCad: 91_000 },
        ],
        "ACC2|CAD": [
          { date: "2022-03-21", gainCad: 80, priorCad: 40_000 },
          { date: "2026-05-27", gainCad: 300, priorCad: 40_500 },
        ],
      },
      asOfNow: "2026-05-29T22:00:00",
      currentByAccount: {
        "ACC|CAD": {
          totalCad: 91_000,
          positionsCad: 91_000,
          cashCad: 0,
          dayGainCad: null,
          dayPriorCad: null,
        },
        "ACC2|CAD": {
          totalCad: 40_500,
          positionsCad: 40_500,
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
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "all",
    );
    assert.equal(all.incomplete, false);
    assert.equal(all.note, null);
    assert.equal(all.baselineDate, "2022-03-20");
    assert.equal(all.annualized, true);
  });

  test("AAJ : pas d alerte si séances dès le début d année", () => {
    const payload = mockPayload({
      historyPoints: [
        {
          accountKey: "ACC|CAD",
          asOf: "2025-12-31",
          totalValueNative: 80_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC2|CAD",
          asOf: "2025-12-31",
          totalValueNative: 40_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC|CAD",
          asOf: "2026-06-02",
          totalValueNative: 90_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC2|CAD",
          asOf: "2026-06-02",
          totalValueNative: 40_100,
          currency: "CAD",
        },
      ],
      sessionGainsByAccount: {
        "ACC|CAD": [
          { date: "2026-01-02", gainCad: 500, priorCad: 80_000 },
          { date: "2026-05-29", gainCad: 1_000, priorCad: 90_000 },
        ],
        "ACC2|CAD": [
          { date: "2026-01-02", gainCad: 200, priorCad: 40_000 },
          { date: "2026-05-29", gainCad: 100, priorCad: 40_100 },
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
    assert.equal(ytd.baselineDate, "2025-12-31");
    // < 1 an → rendement cumulé, pas annualisé.
    assert.equal(ytd.annualized, false);
  });

  test("3 ans : pas de % aberrant si historique titres partiel aux bornes", () => {
    const payload = mockPayload({
      historyPoints: [
        {
          accountKey: "ACC|CAD",
          asOf: "2023-06-09",
          totalValueNative: 5_000,
          currency: "CAD",
        },
      ],
      sessionGainsByAccount: {
        "ACC|CAD": [
          { date: "2025-06-02", gainCad: 500, priorCad: 200_000 },
          { date: "2026-06-09", gainCad: 1_000, priorCad: 250_000 },
        ],
        "ACC2|CAD": [
          { date: "2025-06-02", gainCad: 300, priorCad: 150_000 },
          { date: "2026-06-09", gainCad: 800, priorCad: 180_000 },
        ],
      },
      asOfNow: "2026-06-10T22:00:00",
      currentByAccount: {
        "ACC|CAD": {
          totalCad: 250_000,
          positionsCad: 250_000,
          cashCad: 0,
          dayGainCad: null,
          dayPriorCad: null,
        },
        "ACC2|CAD": {
          totalCad: 200_000,
          positionsCad: 200_000,
          cashCad: 0,
          dayGainCad: null,
          dayPriorCad: null,
        },
      },
    });

    const year3 = computePeriodResult(
      payload,
      {
        preset: "disnat",
        owner: null,
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "year3",
    );

    assert.ok((year3.gainPct ?? 0) < 80, `3 ans ne doit pas exploser: ${year3.gainPct}`);
    assert.equal(year3.incomplete, true);
  });

  test("3 ans / total : pas d alerte si un sous-compte n a pas de sessions mais bornes titres complètes", () => {
    const payload = mockPayload({
      accounts: [
        {
          accountKey: "ACC|CAD",
          label: "Actif",
          owner: "Alice",
          accountType: null,
          currency: "CAD",
          isExternal: false,
        },
        {
          accountKey: "ACC2|CAD",
          label: "Sans sessions",
          owner: "Alice",
          accountType: null,
          currency: "CAD",
          isExternal: false,
        },
      ],
      historyPoints: [
        {
          accountKey: "ACC|CAD",
          asOf: "2023-06-09",
          totalValueNative: 100_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC2|CAD",
          asOf: "2023-06-09",
          totalValueNative: 50_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC|CAD",
          asOf: "2026-06-10",
          totalValueNative: 120_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC2|CAD",
          asOf: "2026-06-10",
          totalValueNative: 55_000,
          currency: "CAD",
        },
      ],
      sessionGainsByAccount: {
        "ACC|CAD": [
          { date: "2024-01-03", gainCad: 500, priorCad: 100_000 },
          { date: "2026-06-10", gainCad: 700, priorCad: 119_300 },
        ],
        "ACC2|CAD": [],
      },
      sessionGainsByDate: [
        { date: "2024-01-03", gainCad: 500, priorCad: 100_000 },
        { date: "2026-06-10", gainCad: 700, priorCad: 119_300 },
      ],
      currentByAccount: {
        "ACC|CAD": {
          totalCad: 120_000,
          positionsCad: 120_000,
          cashCad: 0,
          dayGainCad: null,
          dayPriorCad: null,
        },
        "ACC2|CAD": {
          totalCad: 55_000,
          positionsCad: 55_000,
          cashCad: 0,
          dayGainCad: null,
          dayPriorCad: null,
        },
      },
      asOfNow: "2026-06-10T22:00:00",
    });

    const year3 = computePeriodResult(
      payload,
      {
        preset: "disnat",
        owner: null,
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "year3",
    );
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

    assert.equal(year3.incomplete, false);
    assert.equal(all.incomplete, false);
  });

  test("AAJ : alerte si séances tardives sans historique titres au début d année", () => {
    const payload = mockPayload({
      historyPoints: [],
      sessionGainsByAccount: {
        "ACC|CAD": [
          { date: "2026-03-03", gainCad: 500, priorCad: 80_000 },
          { date: "2026-05-29", gainCad: 1_000, priorCad: 90_000 },
        ],
      },
      sessionGainsByDate: [
        { date: "2026-03-03", gainCad: 500, priorCad: 80_000 },
        { date: "2026-05-29", gainCad: 1_000, priorCad: 90_000 },
      ],
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
    assert.match(ytd.note ?? "", /historique de séances incomplet|historique titres incomplet/);
  });

  test("invariant AAJ: le $ affiché suit la même base que le calcul titres", () => {
    const payload = mockPayload({
      asOfNow: "2026-06-12T15:00:00",
      accounts: [
        {
          accountKey: "ACC|CAD",
          label: "CELI",
          owner: "Alice",
          accountType: "CELI",
          currency: "CAD",
          isExternal: false,
        },
      ],
      currentByAccount: {
        "ACC|CAD": {
          totalCad: 15_000,
          positionsCad: 15_000,
          cashCad: 0,
          dayGainCad: 50,
          dayPriorCad: 14_950,
        },
      },
      historyPoints: [
        {
          accountKey: "ACC|CAD",
          asOf: "2025-12-31",
          totalValueNative: 10_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC|CAD",
          asOf: "2026-06-12",
          totalValueNative: 14_900,
          currency: "CAD",
        },
      ],
      sessionGainsByAccount: {
        "ACC|CAD": [
          { date: "2026-03-03", gainCad: 2_000, priorCad: 11_000 },
          { date: "2026-06-11", gainCad: 1_500, priorCad: 14_000 },
        ],
      },
      sessionGainsByDate: [
        { date: "2026-03-03", gainCad: 2_000, priorCad: 11_000 },
        { date: "2026-06-11", gainCad: 1_500, priorCad: 14_000 },
      ],
      cashFlows: [
        {
          accountKey: "ACC|CAD",
          tradeDate: "2026-04-15",
          txCategory: "CONTRIBUTION",
          amountCad: 4_900,
        },
      ],
    });

    const filters = {
      preset: "all" as const,
      owner: null,
      includedAccountKeys: [],
      excludedAccountKeys: [],
      selectedYear: 2026,
    };
    const ytd = computePeriodResult(payload, filters, "ytd");
    const bounds = resolvePeriodBounds("ytd", new Date(payload.asOfNow), 2026, null);
    const titres = computeTitresPeriodGain(["ACC|CAD"], payload, bounds, "ytd");

    assert.ok(titres.usable && titres.gainCad != null);
    assert.equal(ytd.gainCad, titres.gainCad);
  });

  test("AAJ : $ et % restent cohérents sur la même période", () => {
    const payload = mockPayload({
      accounts: [
        {
          accountKey: "ACC|CAD",
          label: "CELI",
          owner: "Alice",
          accountType: "CELI",
          currency: "CAD",
          isExternal: false,
        },
      ],
      currentByAccount: {
        "ACC|CAD": {
          totalCad: 115_000,
          positionsCad: 115_000,
          cashCad: 0,
          dayGainCad: 0,
          dayPriorCad: 115_000,
        },
      },
      historyPoints: [
        {
          accountKey: "ACC|CAD",
          asOf: "2025-12-31",
          totalValueNative: 100_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC|CAD",
          asOf: "2026-06-12",
          totalValueNative: 115_000,
          currency: "CAD",
        },
      ],
      sessionGainsByAccount: {
        "ACC|CAD": [
          { date: "2026-01-02", gainCad: 10_000, priorCad: 100_000 },
          { date: "2026-06-12", gainCad: 5_000, priorCad: 110_000 },
        ],
      },
      sessionGainsByDate: [
        { date: "2026-01-02", gainCad: 10_000, priorCad: 100_000 },
        { date: "2026-06-12", gainCad: 5_000, priorCad: 110_000 },
      ],
      cashFlows: [],
      asOfNow: "2026-06-12T15:00:00",
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

    assert.ok((ytd.gainPct ?? 0) > 10);
    assert.ok((ytd.gainCad ?? 0) > 10_000);
    assert.equal(ytd.incomplete, false);
  });
});

describe("gain $ — aligné période (EMV − BMV − flux)", () => {
  test("YTD : gain $ utilise EMV de fin de période (live si disponible)", () => {
    const sessionGainsByAccount = {
      "ACC|CAD": [
        { date: "2026-03-03", gainCad: 2_000, priorCad: 11_000 },
        { date: "2026-06-11", gainCad: 1_500, priorCad: 14_000 },
      ],
    };
    const sessionGainsByDate = [
      { date: "2026-03-03", gainCad: 2_000, priorCad: 11_000 },
      { date: "2026-06-11", gainCad: 1_500, priorCad: 14_000 },
    ];
    const payload = mockPayload({
      accounts: [
        {
          accountKey: "ACC|CAD",
          label: "CELI",
          owner: "Alice",
          accountType: "CELI",
          currency: "CAD",
          isExternal: false,
        },
      ],
      currentByAccount: {
        "ACC|CAD": {
          totalCad: 15_000,
          positionsCad: 15_000,
          cashCad: 0,
          dayGainCad: 50,
          dayPriorCad: 14_950,
        },
      },
      historyPoints: [
        {
          accountKey: "ACC|CAD",
          asOf: "2025-12-31",
          totalValueNative: 10_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC|CAD",
          asOf: "2026-06-12",
          totalValueNative: 14_900,
          currency: "CAD",
        },
      ],
      sessionGainsByAccount,
      sessionGainsByDate,
      cashFlows: [
        {
          accountKey: "ACC|CAD",
          tradeDate: "2026-04-15",
          txCategory: "CONTRIBUTION",
          amountCad: 4_900,
        },
      ],
      asOfNow: "2026-06-12T15:00:00",
    });

    const ytd = computePeriodResult(
      payload,
      {
        preset: "all",
        owner: null,
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "ytd",
    );

    assert.equal(ytd.gainCad, 0);
    assert.notEqual(ytd.gainCad, 3_500);
    assert.match(ytd.note ?? "", /entrées de capitaux/i);
  });

  test("YTD multi-comptes : somme EMV − BMV − flux", () => {
    const sessionGainsByAccount = {
      "ACC|CAD": [{ date: "2026-01-02", gainCad: 100, priorCad: 10_000 }],
      "ACC2|USD": [{ date: "2026-01-02", gainCad: 200, priorCad: 11_200 }],
    };
    const payload = mockPayload({
      accounts: [
        {
          accountKey: "ACC|CAD",
          label: "CELI",
          owner: "Alice",
          accountType: "CELI",
          currency: "CAD",
          isExternal: false,
        },
        {
          accountKey: "ACC2|USD",
          label: "REER",
          owner: "Alice",
          accountType: "REER",
          currency: "USD",
          isExternal: false,
        },
      ],
      currentByAccount: {
        "ACC|CAD": {
          totalCad: 11_000,
          positionsCad: 11_000,
          cashCad: 0,
          dayGainCad: 0,
          dayPriorCad: 10_000,
        },
        "ACC2|USD": {
          totalCad: 14_000,
          positionsCad: 14_000,
          cashCad: 0,
          dayGainCad: 0,
          dayPriorCad: 11_200,
        },
      },
      historyPoints: [
        {
          accountKey: "ACC|CAD",
          asOf: "2025-12-31",
          totalValueNative: 9_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC2|USD",
          asOf: "2025-12-31",
          totalValueNative: 8_000,
          currency: "USD",
        },
        {
          accountKey: "ACC|CAD",
          asOf: "2026-06-12",
          totalValueNative: 10_600,
          currency: "CAD",
        },
        {
          accountKey: "ACC2|USD",
          asOf: "2026-06-12",
          totalValueNative: 7_571.43,
          currency: "USD",
        },
      ],
      sessionGainsByAccount,
      sessionGainsByDate: [
        { date: "2026-01-02", gainCad: 300, priorCad: 21_200 },
      ],
      cashFlows: [],
      usdToCad: 1.4,
      asOfNow: "2026-06-12T15:00:00",
    });

    const ytd = computePeriodResult(
      payload,
      {
        preset: "all",
        owner: null,
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "ytd",
    );

    assert.ok(Math.abs(ytd.gainCad ?? 0) < 1);
  });

  test("buildPerformanceCashFlows : settlementDate alimente le calcul", () => {
    const flows = buildPerformanceCashFlowsFromTxRows(
      [
        {
          accountKey: "ACC|CAD",
          tradeDate: null,
          settlementDate: new Date("2026-04-15T16:00:00Z"),
          txCategory: "CONTRIBUTION",
          amount: 4_900,
          currency: "CAD",
        },
      ],
      null,
    );
    const payload = mockPayload({
      accounts: [
        {
          accountKey: "ACC|CAD",
          label: "CELI",
          owner: "Alice",
          accountType: "CELI",
          currency: "CAD",
          isExternal: false,
        },
      ],
      currentByAccount: {
        "ACC|CAD": {
          totalCad: 15_000,
          positionsCad: 15_000,
          cashCad: 0,
          dayGainCad: 0,
          dayPriorCad: 15_000,
        },
      },
      historyPoints: [
        {
          accountKey: "ACC|CAD",
          asOf: "2025-12-31",
          totalValueNative: 10_000,
          currency: "CAD",
        },
        {
          accountKey: "ACC|CAD",
          asOf: "2026-06-12",
          totalValueNative: 14_900,
          currency: "CAD",
        },
      ],
      sessionGainsByAccount: {
        "ACC|CAD": [{ date: "2026-06-11", gainCad: 9_999, priorCad: 10_000 }],
      },
      sessionGainsByDate: [{ date: "2026-06-11", gainCad: 9_999, priorCad: 10_000 }],
      cashFlows: flows,
      asOfNow: "2026-06-12T15:00:00",
    });

    const ytd = computePeriodResult(
      payload,
      {
        preset: "all",
        owner: null,
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear: 2026,
      },
      "ytd",
    );
    assert.equal(ytd.gainCad, 0);
  });
});
