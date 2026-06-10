import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assessSessionDataHealth } from "./performance-facts-health";
import { listTradingDaysInRange } from "@/lib/fx/usd-cad-rate-map";

describe("assessSessionDataHealth", () => {
  test("refuse une série vide", () => {
    const health = assessSessionDataHealth([], new Date("2026-06-03T15:00:00"));
    assert.equal(health.ok, false);
    assert.match(health.message ?? "", /Aucune séance/);
  });

  test("refuse NaN", () => {
    const health = assessSessionDataHealth(
      [{ date: "2026-06-02", gainCad: Number.NaN, priorCad: 1 }],
      new Date("2026-06-03T15:00:00"),
    );
    assert.equal(health.ok, false);
    assert.match(health.message ?? "", /NaN/);
  });

  test("accepte une couverture récente complète", () => {
    const days = listTradingDaysInRange("2026-05-05", "2026-06-03");
    const rows = days.map((date) => ({
      date,
      gainCad: 100,
      priorCad: 10_000,
    }));

    const health = assessSessionDataHealth(rows, new Date("2026-06-03T15:00:00"));
    assert.equal(health.ok, true);
  });

  test("en séance ouverte : n exige pas les gains du jour courant", () => {
    const days = listTradingDaysInRange("2026-05-12", "2026-06-09");
    const rows = days.map((date) => ({
      date,
      gainCad: 100,
      priorCad: 10_000,
    }));

    const health = assessSessionDataHealth(rows, new Date("2026-06-10T14:00:00-04:00"));
    assert.equal(health.ok, true, health.message ?? undefined);
  });
});
