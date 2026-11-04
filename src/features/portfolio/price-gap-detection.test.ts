import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildPriceGapReport,
  type PriceGapHoldingRow,
  type PriceGapPriceRow,
} from "./price-gap-detection";

function holding(date: string, ticker: string, currency: string): PriceGapHoldingRow {
  return { date, ticker, currency };
}

function price(
  date: string,
  ticker: string,
  currency: string,
  source = "yahoo-chart",
): PriceGapPriceRow {
  return { date, ticker, currency, source };
}

describe("buildPriceGapReport", () => {
  test("aucun trou quand chaque séance détenue a une clôture", () => {
    const report = buildPriceGapReport(
      [
        holding("2026-07-02", "AAA-C", "CAD"),
        holding("2026-07-03", "AAA-C", "CAD"),
      ],
      [
        price("2026-07-02", "AAA-C", "CAD"),
        price("2026-07-03", "AAA-C", "CAD"),
        price("2026-07-02", "BBB-C", "CAD"),
        price("2026-07-03", "BBB-C", "CAD"),
      ],
    );

    assert.equal(report.missingSessions, 0);
    assert.equal(report.pairsWithGaps.length, 0);
    assert.equal(report.heldSessionsChecked, 2);
  });

  test("un férié TSX (aucune paire CAD cotée) n'est pas un trou", () => {
    /* 2026-07-01 = mercredi, Fête du Canada : TSX fermée, NYSE ouverte. */
    const report = buildPriceGapReport(
      [holding("2026-07-01", "AAA-C", "CAD")],
      [
        price("2026-06-30", "AAA-C", "CAD"),
        price("2026-07-02", "AAA-C", "CAD"),
        price("2026-07-01", "SPY-U", "USD"),
        price("2026-07-01", "QQQ-U", "USD"),
      ],
    );

    assert.equal(report.missingSessions, 0);
    assert.equal(report.unverifiedSessions, 1);
  });

  test("un férié US (aucune paire USD cotée) n'est pas un trou", () => {
    /* 2026-07-03 = vendredi, 4 juillet observé : NYSE fermée, TSX ouverte. */
    const report = buildPriceGapReport(
      [holding("2026-07-03", "SPY-U", "USD")],
      [
        price("2026-07-02", "SPY-U", "USD"),
        price("2026-07-03", "AAA-C", "CAD"),
        price("2026-07-03", "BBB-C", "CAD"),
      ],
    );

    assert.equal(report.missingSessions, 0);
    assert.equal(report.unverifiedSessions, 1);
  });

  test("un trou réel est détecté quand le marché est ouvert ailleurs", () => {
    const report = buildPriceGapReport(
      [holding("2026-07-02", "AAA-C", "CAD")],
      [
        price("2026-07-01", "AAA-C", "CAD"),
        price("2026-07-03", "AAA-C", "CAD"),
        price("2026-07-02", "BBB-C", "CAD"),
        price("2026-07-02", "CCC-C", "CAD"),
      ],
    );

    assert.equal(report.missingSessions, 1);
    assert.equal(report.pairsWithGaps.length, 1);
    assert.deepEqual(report.pairsWithGaps[0]!.missingDates, ["2026-07-02"]);
    assert.equal(report.pairsWithGaps[0]!.market, "TSX");
  });

  test("les écritures yahoo-live ne créent pas de séance fantôme", () => {
    /* Halloween : NYSE ouverte, mais seules des écritures live existent → non vérifiable. */
    const report = buildPriceGapReport(
      [holding("2025-10-31", "SPY-U", "USD")],
      [
        price("2025-10-30", "SPY-U", "USD"),
        price("2025-10-31", "SPY", "USD", "yahoo-live"),
        price("2025-10-31", "QQQ", "USD", "yahoo-live"),
      ],
    );

    assert.equal(report.missingSessions, 0);
    assert.equal(report.unverifiedSessions, 1);
  });

  test("les holdings hors séance (week-end) sont ignorés", () => {
    const report = buildPriceGapReport(
      [
        holding("2026-07-04", "AAA-C", "CAD"),
        holding("2026-07-05", "AAA-C", "CAD"),
      ],
      [price("2026-07-02", "AAA-C", "CAD")],
    );

    assert.equal(report.ignoredNonTradingHoldingDates, 2);
    assert.equal(report.heldSessionsChecked, 0);
    assert.equal(report.missingSessions, 0);
  });

  test("paire sans aucune clôture : signalée + séances après la dernière clôture", () => {
    const report = buildPriceGapReport(
      [
        holding("2026-07-02", "ZZZ-U", "USD"),
        holding("2026-07-03", "ZZZ-U", "USD"),
      ],
      [
        price("2026-07-02", "SPY-U", "USD"),
        price("2026-07-02", "QQQ-U", "USD"),
        price("2026-07-03", "SPY-U", "USD"),
        price("2026-07-03", "QQQ-U", "USD"),
      ],
    );

    assert.equal(report.missingSessions, 2);
    assert.equal(report.pairsWithoutAnyClose.length, 1);
    assert.equal(report.pairsWithoutAnyClose[0]!.lastCloseDate, null);
    assert.equal(report.pairsWithoutAnyClose[0]!.sessionsAfterLastClose, 2);
  });

  test("série arrêtée : compte les séances détenues après la dernière clôture", () => {
    const report = buildPriceGapReport(
      [
        holding("2026-07-02", "AAA-C", "CAD"),
        holding("2026-07-03", "AAA-C", "CAD"),
      ],
      [
        price("2026-07-02", "AAA-C", "CAD"),
        price("2026-07-02", "BBB-C", "CAD"),
        price("2026-07-03", "BBB-C", "CAD"),
        price("2026-07-02", "CCC-C", "CAD"),
        price("2026-07-03", "CCC-C", "CAD"),
      ],
    );

    assert.equal(report.missingSessions, 1);
    assert.equal(report.pairsWithGaps[0]!.lastCloseDate, "2026-07-02");
    assert.equal(report.pairsWithGaps[0]!.sessionsAfterLastClose, 1);
  });

  test("échantillon de dates borné par maxDatesPerPair", () => {
    const holdings = [
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
    ].map((date) => holding(date, "AAA-C", "CAD"));
    const prices = holdings.flatMap((row) => [
      price(row.date, "BBB-C", "CAD"),
      price(row.date, "CCC-C", "CAD"),
    ]);

    const report = buildPriceGapReport(holdings, prices, { maxDatesPerPair: 2 });

    assert.equal(report.pairsWithGaps[0]!.missingSessions, 4);
    assert.equal(report.pairsWithGaps[0]!.missingDates.length, 2);
  });
});
