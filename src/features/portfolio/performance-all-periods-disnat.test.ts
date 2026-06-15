/**
 * Régression multi-périodes vs captures Disnat ($ et %).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getPerformanceIndicatorPayload } from "./performance-indicator-queries";
import {
  computePeriodResult,
  defaultPerformanceFilters,
} from "./performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";
import {
  DISNAT_RETURNS_BENCHMARK,
  DISNAT_RETURN_TOLERANCE_PCT,
} from "./fixtures/disnat-returns-benchmark.fixture";
import {
  DISNAT_DOLLARS_BENCHMARK,
  DISNAT_DOLLARS_TOLERANCE_ACCOUNT,
} from "./fixtures/disnat-dollars-benchmark.fixture";

const hasDb = Boolean(process.env.DATABASE_URL);
const AS_OF = "2026-06-12T15:00:00";

const ACCOUNT_KEYS = ["5KFZEZ2|CAD", "5L3APY0|CAD"] as const;

describe("Performance — toutes périodes vs Disnat", { skip: !hasDb }, () => {
  test("$ et % même signe sur périodes annualisées (year3, all)", async () => {
    const payload = await getPerformanceIndicatorPayload();
    payload.asOfNow = AS_OF;
    const filters = defaultPerformanceFilters(payload);

    for (const periodId of ["year3", "all"] as const) {
      const r = computePeriodResult(payload, filters, periodId);
      if (r.gainCad == null || r.gainPct == null) continue;
      if (Math.abs(r.gainPct) < 0.01 || Math.abs(r.gainCad) < 1) continue;
      assert.equal(
        Math.sign(r.gainCad),
        Math.sign(r.gainPct),
        `${periodId} : gain $ et % de signes opposés (${r.gainCad} vs ${r.gainPct}%)`,
      );
    }
  });

  test("$ par compte — toutes périodes benchmarkées", async () => {
    const payload = await getPerformanceIndicatorPayload();
    payload.asOfNow = AS_OF;

    for (const accountKey of ACCOUNT_KEYS) {
      const ref =
        DISNAT_DOLLARS_BENCHMARK.yann.byAccountKey[accountKey] ??
        DISNAT_DOLLARS_BENCHMARK.valerie.byAccountKey[accountKey];
      assert.ok(ref, `${accountKey} absent du benchmark`);

      for (const [periodId, disnatRef] of Object.entries(ref)) {
        if (disnatRef == null) continue;
        const r = computePeriodResult(
          payload,
          {
            ...defaultPerformanceFilters(payload),
            preset: "custom",
            includedAccountKeys: [accountKey],
            excludedAccountKeys: [],
          },
          periodId as "ytd",
        );
        assert.ok(r.gainCad != null, `${accountKey} ${periodId} gainCad null`);
        const delta = Math.abs(r.gainCad - disnatRef);
        assert.ok(
          delta < DISNAT_DOLLARS_TOLERANCE_ACCOUNT,
          `${accountKey} ${periodId} $=${Math.round(r.gainCad)} vs disnat=${disnatRef} (Δ=${Math.round(delta)})`,
        );
      }
    }
  });

  test("journalise écarts % consolidés (non bloquant)", async () => {
    const payload = await getPerformanceIndicatorPayload();
    payload.asOfNow = AS_OF;
    const owners = uniquePortfolioOwners(payload.accounts.map((a) => a.owner));
    const periods = ["month", "month3", "year", "year3", "ytd", "all"] as const;
    const report: string[] = [];

    for (const owner of owners) {
      const lower = owner.toLowerCase();
      const ref = lower.includes("yann")
        ? DISNAT_RETURNS_BENCHMARK.yann
        : lower.includes("valerie") || lower.includes("degrandpre")
          ? DISNAT_RETURNS_BENCHMARK.valerie
          : null;
      if (!ref) continue;

      for (const periodId of periods) {
        const refPct = ref[periodId];
        if (refPct == null) continue;
        const r = computePeriodResult(
          payload,
          { ...defaultPerformanceFilters(payload), owner, preset: "disnat" },
          periodId,
        );
        const delta =
          r.gainPct != null ? (r.gainPct - refPct).toFixed(2) : "—";
        const ok =
          r.gainPct != null &&
          Math.abs(r.gainPct - refPct) <= DISNAT_RETURN_TOLERANCE_PCT;
        report.push(
          `${ok ? "✓" : "✗"} ${owner} ${periodId}: app=${r.gainPct?.toFixed(2) ?? "—"}% disnat=${refPct}% Δ=${delta}`,
        );
      }
    }

    console.log("[disnat-all-periods]\n" + report.join("\n"));
    assert.ok(report.length > 0);
  });
});
