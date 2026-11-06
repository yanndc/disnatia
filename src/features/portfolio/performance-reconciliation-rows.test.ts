import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReconciliationRows,
  reconciliationAsOf,
  reconciliationReportDates,
} from "./performance-reconciliation-rows";
import type {
  PerformanceAccountRef,
  PerformanceFilterState,
  PerformanceIndicatorPayload,
} from "./performance-indicator-types";

const Z2 = "5KFZEZ2|CAD";
const A9 = "5KFZEA9|CAD";

function account(accountKey: string): PerformanceAccountRef {
  return {
    accountKey,
    label: accountKey,
    owner: "Yann de Champlain",
    accountType: "CELI",
    currency: "CAD",
    isExternal: false,
  };
}

function filters(overrides: Partial<PerformanceFilterState> = {}): PerformanceFilterState {
  return {
    preset: "disnat",
    owner: null,
    portfolioKey: null,
    includedAccountKeys: [],
    excludedAccountKeys: [],
    selectedYear: 2026,
    activePeriod: "day",
    ...overrides,
  };
}

function payload(overrides: Partial<PerformanceIndicatorPayload> = {}): PerformanceIndicatorPayload {
  return {
    accounts: [account(Z2), account(A9)],
    currentByAccount: {
      [Z2]: {
        totalCad: 30_000,
        positionsCad: 30_000,
        cashCad: 0,
        totalNative: 30_000,
        positionsNative: 30_000,
        cashNative: 0,
        dayGainCad: null,
        dayPriorCad: null,
      },
      [A9]: {
        totalCad: 0,
        positionsCad: 0,
        cashCad: 0,
        totalNative: 0,
        positionsNative: 0,
        cashNative: 0,
        dayGainCad: null,
        dayPriorCad: null,
      },
    },
    snapshots: [],
    historyPoints: [
      { accountKey: Z2, asOf: "2026-11-05", totalValueNative: 29_000, currency: "CAD" },
    ],
    dailyTotalsCad: [],
    sessionGainsByDate: [],
    sessionGainsByAccount: {},
    sessionDataHealth: { ok: true, message: null, persistedDays: 0, firstDate: null, lastDate: null },
    performanceSnapshots: null,
    cashFlows: [],
    accountCashLedgers: {},
    holdings: [],
    enrichedHoldings: [],
    dailyCloses: {},
    usdToCad: 1.4,
    usdToCadDate: "2026-11-06",
    usdCadRateByDate: {},
    availableYears: [2026],
    quotesAsOf: null,
    asOfNow: "2026-11-06",
    ...overrides,
  };
}

const favori = {
  clientCode: "5KFZE",
  asOf: "2026-11-06",
  securitiesCad: 29_500,
  cashCad: 500,
  totalCad: 30_000,
};

describe("reconciliationAsOf", () => {
  test("renvoie le jour ISO seul (aucun décalage en dur, donc DST-safe)", () => {
    assert.equal(reconciliationAsOf("2026-08-20"), "2026-08-20");
    assert.ok(!reconciliationAsOf("2026-01-15").includes("T"));
  });
});

describe("reconciliationReportDates", () => {
  test("réunit imports et captures du favori, du plus récent au plus ancien", () => {
    const dates = reconciliationReportDates(
      payload({
        snapshots: [{ accountKey: Z2, asOf: "2026-09-29", totalValueNative: 1, currency: "CAD" }],
        clientCashSnapshots: [favori],
      }),
    );
    assert.deepEqual(dates, ["2026-11-06", "2026-09-29"]);
  });

  test("retourne un tableau vide sans aucune source", () => {
    assert.deepEqual(reconciliationReportDates(payload()), []);
  });
});

describe("buildReconciliationRows", () => {
  test("utilise la fin de période officielle du favori et ignore les comptes vides", () => {
    const [row] = buildReconciliationRows({
      payload: payload({ clientCashSnapshots: [favori] }),
      filters: filters(),
      portfolios: [],
      reportDates: ["2026-11-06"],
    });

    assert.ok(row);
    assert.equal(row.accountsUsed, 1, "le compte d'encaisse vide est exclu");
    assert.equal(row.accountsExpected, 1);
    assert.equal(row.incomplete, false);
    // 29 500 (fin officielle) − 29 000 (clôture de la veille) − 0 flux
    assert.equal(row.refGainCad, 500);
    assert.ok(
      row.reasons.some((r) =>
        r.startsWith("Fin de période officielle (favori Disnat du 2026-11-06)"),
      ),
    );
    assert.ok(!row.reasons.includes("Couverture comptes incomplète"));
  });

  test("ignore une capture favori périmée (> 5 séances)", () => {
    const [row] = buildReconciliationRows({
      payload: payload({
        clientCashSnapshots: [favori],
        historyPoints: [
          { accountKey: Z2, asOf: "2026-11-30", totalValueNative: 30_000, currency: "CAD" },
          { accountKey: Z2, asOf: "2026-12-01", totalValueNative: 30_200, currency: "CAD" },
        ],
      }),
      filters: filters(),
      portfolios: [],
      reportDates: ["2026-12-01"],
    });

    assert.ok(row);
    // 30 200 (1er déc.) − 30 000 (30 nov.) : la reconstruction locale reprend la main
    assert.equal(row.refGainCad, 200);
    assert.ok(!row.reasons.some((r) => r.startsWith("Fin de période officielle")));
  });

  test("calcule les bornes à la date du rapport, pas à aujourd'hui", () => {
    const rows = buildReconciliationRows({
      payload: payload({
        clientCashSnapshots: [favori],
        historyPoints: [
          { accountKey: Z2, asOf: "2026-08-19", totalValueNative: 28_000, currency: "CAD" },
          { accountKey: Z2, asOf: "2026-11-05", totalValueNative: 29_000, currency: "CAD" },
        ],
      }),
      filters: filters(),
      portfolios: [],
      reportDates: ["2026-11-06", "2026-08-20"],
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.periodStart, "2026-11-06");
    assert.equal(rows[0]!.periodEnd, "2026-11-06");
    assert.equal(rows[1]!.periodStart, "2026-08-20");
    assert.equal(rows[1]!.periodEnd, "2026-08-20");
    // Le rapport d'août reste calculé sur ses propres points (pas la séance du jour).
    assert.equal(rows[1]!.refGainCad, 0);
  });

  test("limite le nombre de lignes demandé", () => {
    const rows = buildReconciliationRows({
      payload: payload(),
      filters: filters(),
      portfolios: [],
      reportDates: ["2026-11-06", "2026-11-05", "2026-11-04"],
      limit: 2,
    });
    assert.equal(rows.length, 2);
  });

  test("signale l'absence de bornes quand rien n'est conciliable", () => {
    const [row] = buildReconciliationRows({
      payload: payload({ accounts: [account(A9)], currentByAccount: {} }),
      filters: filters(),
      portfolios: [],
      reportDates: ["2026-11-06"],
    });
    assert.ok(row);
    assert.equal(row.accountsExpected, 0);
    assert.equal(row.incomplete, true);
    assert.deepEqual(row.reasons, [
      "Bornes de période indisponibles ou aucun compte Disnat dans la portée.",
    ]);
  });
});

