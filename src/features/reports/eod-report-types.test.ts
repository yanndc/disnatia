import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildEodDailyPerformanceRows, summarizeEodDailyPerformance } from "./eod-report-types";

describe("buildEodDailyPerformanceRows", () => {
  test("retient les 20 dernières séances dans l'ordre et calcule le rendement", () => {
    const sessions = Array.from({ length: 25 }, (_, index) => ({
      date: `2026-05-${String(index + 1).padStart(2, "0")}`,
      gainCad: index * 100,
      priorCad: 10_000,
    }));

    const rows = buildEodDailyPerformanceRows(sessions);

    assert.equal(rows.length, 20);
    assert.equal(rows[0]?.date, "2026-05-06");
    assert.equal(rows[19]?.date, "2026-05-25");
    assert.equal(rows[19]?.gainPct, 24);
  });

  test("retourne null lorsque la valeur de référence est nulle", () => {
    const rows = buildEodDailyPerformanceRows([
      { date: "2026-05-12", gainCad: 200, priorCad: 0 },
    ]);

    assert.equal(rows[0]?.gainPct, null);
  });
});

describe("summarizeEodDailyPerformance", () => {
  test("cumule les gains en $ et compose les rendements", () => {
    const total = summarizeEodDailyPerformance([
      { date: "2026-05-11", gainCad: 100, gainPct: 1 },
      { date: "2026-05-12", gainCad: -50, gainPct: -0.5 },
      { date: "2026-05-13", gainCad: 250, gainPct: 2 },
    ]);

    assert.equal(total.gainCad, 300);
    assert.ok(total.gainPct !== null);
    assert.ok(Math.abs(total.gainPct - 2.5049) < 1e-9);
  });

  test("ignore les rendements inconnus et gère la liste vide", () => {
    assert.deepEqual(summarizeEodDailyPerformance([]), { gainCad: 0, gainPct: null });

    const total = summarizeEodDailyPerformance([
      { date: "2026-05-11", gainCad: 100, gainPct: null },
    ]);
    assert.equal(total.gainCad, 100);
    assert.equal(total.gainPct, 0);
  });
});