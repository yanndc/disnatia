import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeModifiedDietzReturn,
  computeTwrFromSessions,
  resolvePeriodReturnPercent,
  weightedExternalFlowsForDietz,
} from "./performance-return-methods";
import type { PerformanceCashFlow } from "./performance-indicator-types";

describe("computeTwrFromSessions", () => {
  test("1 séance → gain / prior", () => {
    const hit = computeTwrFromSessions(
      [{ date: "2026-05-01", gainCad: 1_000, priorCad: 100_000 }],
      "2026-05-01",
    );
    assert.equal(hit.algorithm, "session-single");
    assert.ok(Math.abs((hit.gainPct ?? 0) - 1) < 0.001);
  });

  test("enchaîne deux séances", () => {
    const sessions = [
      { date: "2026-05-01", gainCad: 1_000, priorCad: 100_000 },
      { date: "2026-05-02", gainCad: 500, priorCad: 101_000 },
    ];
    const hit = computeTwrFromSessions(sessions, "2026-05-02");
    const expected = (1 + 1_000 / 100_000) * (1 + 500 / 101_000) - 1;
    assert.equal(hit.algorithm, "twr");
    assert.ok(Math.abs((hit.gainPct ?? 0) / 100 - expected) < 0.0001);
  });
});

describe("computeModifiedDietzReturn", () => {
  test("sans flux : (EMV − BMV) / BMV", () => {
    const hit = computeModifiedDietzReturn(
      100_000,
      110_000,
      0,
      0,
      "2026-01-01",
      "2026-06-01",
    );
    assert.equal(hit.algorithm, "modified-dietz");
    assert.ok(Math.abs((hit.gainPct ?? 0) - 10) < 0.001);
  });

  test("cotisation mi-période (exemple textbook)", () => {
    const bmv = 100_000;
    const emv = 115_000;
    const cf = 10_000;
    const weight = 0.5;
    const hit = computeModifiedDietzReturn(
      bmv,
      emv,
      cf,
      weight * cf,
      "2026-01-01",
      "2026-06-01",
    );
    const expected = ((emv - bmv - cf) / (bmv + weight * cf)) * 100;
    assert.ok(Math.abs((hit.gainPct ?? 0) - expected) < 0.01);
  });
});

describe("resolvePeriodReturnPercent", () => {
  test("privilégie Dietz quand BMV/EMV sont fournis", () => {
    const flows: PerformanceCashFlow[] = [];
    const hit = resolvePeriodReturnPercent({
      sessions: [
        { date: "2026-05-01", gainCad: -500, priorCad: 100_000 },
        { date: "2026-05-02", gainCad: 200, priorCad: 99_500 },
      ],
      periodStart: "2026-05-01",
      periodEnd: "2026-05-02",
      bmv: 100_000,
      emv: 102_000,
      boundaryCoverageComplete: true,
      flows,
      accountKeys: ["ACC|CAD"],
    });
    assert.equal(hit.algorithm, "modified-dietz");
    assert.ok(Math.abs((hit.gainPct ?? 0) - 2) < 0.01);
  });

  test("repli TWR sans historique titres", () => {
    const hit = resolvePeriodReturnPercent({
      sessions: [{ date: "2026-05-01", gainCad: 1_000, priorCad: 100_000 }],
      periodStart: "2026-05-01",
      periodEnd: "2026-05-01",
      bmv: null,
      emv: null,
      boundaryCoverageComplete: false,
      flows: [],
      accountKeys: ["ACC|CAD"],
    });
    assert.equal(hit.algorithm, "session-single");
  });

  test("BMV partielle → TWR (évite Dietz aberrant)", () => {
    const sessions = [
      { date: "2023-06-12", gainCad: 500, priorCad: 200_000 },
      { date: "2026-06-09", gainCad: 1_000, priorCad: 250_000 },
    ];
    const hit = resolvePeriodReturnPercent({
      sessions,
      periodStart: "2023-06-10",
      periodEnd: "2026-06-10",
      bmv: 10_000,
      emv: 250_000,
      boundaryCoverageComplete: false,
      flows: [],
      accountKeys: ["ACC|CAD"],
    });
    assert.equal(hit.algorithm, "twr");
    assert.ok((hit.gainPct ?? 0) < 50, "ne doit pas utiliser Dietz sur BMV partielle");
  });
});

describe("weightedExternalFlowsForDietz", () => {
  test("poids décroissant vers la fin de période", () => {
    const flows: PerformanceCashFlow[] = [
      {
        accountKey: "ACC|CAD",
        tradeDate: "2026-05-01",
        txCategory: "CONTRIBUTION",
        amountCad: 10_000,
      },
      {
        accountKey: "ACC|CAD",
        tradeDate: "2026-05-10",
        txCategory: "CONTRIBUTION",
        amountCad: 5_000,
      },
    ];
    const { sumFlows, weightedFlows } = weightedExternalFlowsForDietz(
      flows,
      ["ACC|CAD"],
      "2026-05-01",
      "2026-05-10",
    );
    assert.equal(sumFlows, 15_000);
    assert.ok(weightedFlows > 0 && weightedFlows < sumFlows);
  });
});
