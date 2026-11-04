import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assessAccountCoverage, countTradingDaysAfter, summarizeCoverage } from "./account-coverage";

/** Mercredi 4 novembre 2026, 15 h UTC : dernière séance attendue = mardi 3 novembre. */
const NOW = new Date("2026-11-04T15:00:00.000Z");

describe("countTradingDaysAfter", () => {
  test("compte les séances strictement après la date de départ, week-end exclu", () => {
    // Vendredi 30 oct → mardi 3 nov : lundi 2 + mardi 3 = 2 séances.
    assert.equal(countTradingDaysAfter("2026-10-30", "2026-11-03"), 2);
  });

  test("retourne 0 quand la donnée est déjà à la dernière séance", () => {
    assert.equal(countTradingDaysAfter("2026-11-03", "2026-11-03"), 0);
  });

  test("retourne 0 quand la donnée est plus récente que la séance attendue", () => {
    assert.equal(countTradingDaysAfter("2026-11-10", "2026-11-03"), 0);
  });
});

describe("assessAccountCoverage", () => {
  test("compte alimenté par des opérations récentes → à jour", () => {
    const coverage = assessAccountCoverage(
      {
        accountKey: "5KFZES7|CAD",
        snapshotAsOf: "2026-09-30",
        lastTransactionDate: "2026-11-02",
        lastConfirmationDataAsOf: null,
        lastConfirmationAt: null,
      },
      NOW,
    );

    assert.equal(coverage.status, "A_JOUR");
    assert.equal(coverage.freshnessSource, "OPERATIONS");
    assert.equal(coverage.staleTradingDays, 1);
    assert.equal(coverage.requiresConfirmation, false);
  });

  test("compte dormant → à confirmer, avec la date attendue suggérée", () => {
    const coverage = assessAccountCoverage(
      {
        accountKey: "REER|CAD",
        snapshotAsOf: "2026-06-30",
        lastTransactionDate: null,
        lastConfirmationDataAsOf: null,
        lastConfirmationAt: null,
      },
      NOW,
    );

    assert.equal(coverage.status, "A_CONFIRMER");
    assert.equal(coverage.freshnessSource, "PORTEFEUILLE");
    assert.ok(coverage.staleTradingDays > 5);
    assert.equal(coverage.requiresConfirmation, true);
    assert.equal(coverage.suggestedDataAsOf, "2026-11-03");
  });

  test("une attestation récente remet le compte à jour sans import", () => {
    const coverage = assessAccountCoverage(
      {
        accountKey: "REER|CAD",
        snapshotAsOf: "2026-06-30",
        lastTransactionDate: "2026-05-12",
        lastConfirmationDataAsOf: "2026-11-03",
        lastConfirmationAt: "2026-11-04T13:20:00.000Z",
      },
      NOW,
    );

    assert.equal(coverage.status, "A_JOUR");
    assert.equal(coverage.freshnessSource, "CONFIRMATION");
    assert.equal(coverage.staleTradingDays, 0);
    assert.equal(coverage.lastConfirmationAt, "2026-11-04T13:20:00.000Z");
  });

  test("compte jamais importé → sans données et à confirmer", () => {
    const coverage = assessAccountCoverage(
      {
        accountKey: "NOUVEAU|CAD",
        snapshotAsOf: null,
        lastTransactionDate: null,
        lastConfirmationDataAsOf: null,
        lastConfirmationAt: null,
      },
      NOW,
    );

    assert.equal(coverage.status, "SANS_DONNEES");
    assert.equal(coverage.freshnessIso, null);
    assert.equal(coverage.requiresConfirmation, true);
  });

  test("summarizeCoverage agrège les statuts", () => {
    const base = {
      snapshotAsOf: "2026-11-03",
      lastTransactionDate: null,
      lastConfirmationDataAsOf: null,
      lastConfirmationAt: null,
    };
    const summary = summarizeCoverage([
      assessAccountCoverage({ ...base, accountKey: "A|CAD" }, NOW),
      assessAccountCoverage(
        { ...base, accountKey: "B|CAD", snapshotAsOf: "2026-01-05" },
        NOW,
      ),
      assessAccountCoverage(
        { ...base, accountKey: "C|CAD", snapshotAsOf: null },
        NOW,
      ),
    ]);

    assert.deepEqual(summary, { total: 3, upToDate: 1, toConfirm: 1, withoutData: 1 });
  });
});
