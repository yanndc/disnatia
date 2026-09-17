import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildEodDailyPerformanceRows } from "./eod-report-types";

describe("buildEodDailyPerformanceRows", () => {
  test("retient les 10 dernières séances dans l'ordre et calcule le rendement", () => {
    const sessions = Array.from({ length: 12 }, (_, index) => ({
      date: `2026-05-${String(index + 1).padStart(2, "0")}`,
      gainCad: index * 100,
      priorCad: 10_000,
    }));

    const rows = buildEodDailyPerformanceRows(sessions);

    assert.equal(rows.length, 10);
    assert.equal(rows[0]?.date, "2026-05-03");
    assert.equal(rows[9]?.date, "2026-05-12");
    assert.equal(rows[9]?.gainPct, 11);
  });

  test("retourne null lorsque la valeur de référence est nulle", () => {
    const rows = buildEodDailyPerformanceRows([
      { date: "2026-05-12", gainCad: 200, priorCad: 0 },
    ]);

    assert.equal(rows[0]?.gainPct, null);
  });
});