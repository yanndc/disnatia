import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeMoneyWeightedReturn, daysBetweenIso } from "./performance-money-weighted";

describe("computeMoneyWeightedReturn — exemple officiel Disnat", () => {
  test("100 000 $ au départ, 3 dépôts de 10 000 $, 1 retrait, 164 000 $ à la fin → 6,71842 %/an", () => {
    const result = computeMoneyWeightedReturn({
      startIso: "2010-12-31",
      startValue: 100_000,
      endIso: "2015-12-31",
      endValue: 164_000,
      flows: [
        { date: "2012-01-15", amount: 10_000, direction: "in" },
        { date: "2013-02-24", amount: 10_000, direction: "in" },
        { date: "2014-03-18", amount: 10_000, direction: "in" },
        { date: "2015-01-25", amount: 10_000, direction: "out" },
      ],
    });
    assert.equal(result.annualized, true);
    assert.equal(result.spanDays, 1826);
    assert.ok(result.gainPct !== null);
    assert.ok(
      Math.abs(result.gainPct! - 6.71842) < 0.01,
      `attendu ≈ 6,71842 %, obtenu ${result.gainPct}`,
    );
  });

  test("sans mouvement : simple variation, non annualisée sous un an", () => {
    const result = computeMoneyWeightedReturn({
      startIso: "2026-01-01",
      startValue: 10_000,
      endIso: "2026-07-01",
      endValue: 10_500,
      flows: [],
    });
    assert.equal(result.annualized, false);
    assert.ok(Math.abs((result.gainPct ?? 0) - 5) < 0.0001);
  });

  test("dépôt en cours de période neutralisé (TRI ≠ simple)", () => {
    const withDeposit = computeMoneyWeightedReturn({
      startIso: "2025-01-01",
      startValue: 100_000,
      endIso: "2026-01-01",
      endValue: 210_000,
      flows: [{ date: "2026-01-01", amount: 100_000, direction: "in" }],
    });
    // 210 000 − 100 000 déposés la veille de la fin : rendement ≈ 10 %.
    assert.ok(Math.abs((withDeposit.gainPct ?? 0) - 10) < 0.6, `obtenu ${withDeposit.gainPct}`);
  });
});

describe("daysBetweenIso", () => {
  test("compte les jours calendaires", () => {
    assert.equal(daysBetweenIso("2026-01-01", "2026-01-31"), 30);
    assert.equal(daysBetweenIso("2026-01-31", "2026-01-01"), 0);
  });
});
