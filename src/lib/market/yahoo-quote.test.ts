import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { previousCloseFromDailyChartBars } from "./yahoo-quote";

describe("previousCloseFromDailyChartBars", () => {
  test("retourne l'avant-dernière clôture valide", () => {
    const closes = [739.17, null, 742.72, 745.64, 750.59, 754.6, 756.48];
    assert.equal(previousCloseFromDailyChartBars(closes), 754.6);
  });

  test("ignore les clôtures invalides", () => {
    assert.equal(previousCloseFromDailyChartBars([756.48]), undefined);
    assert.equal(previousCloseFromDailyChartBars([null, 0, -1, 756.48]), undefined);
  });
});
