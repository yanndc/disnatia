/**
 * Tests de convergence % vs captures Disnat (nécessite POSTGRES — skip si absent).
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

const hasDb = Boolean(process.env.DATABASE_URL);

function ownerRef(owner: string) {
  const lower = owner.toLowerCase();
  if (lower.includes("yann")) return DISNAT_RETURNS_BENCHMARK.yann;
  if (lower.includes("valerie") || lower.includes("degrandpre")) {
    return DISNAT_RETURNS_BENCHMARK.valerie;
  }
  return null;
}

describe("Disnat % — convergence post Phase B", { skip: !hasDb }, () => {
  test("documente écarts app vs capture Disnat (non bloquant)", async () => {
    const payload = await getPerformanceIndicatorPayload();
    const owners = uniquePortfolioOwners(payload.accounts.map((a) => a.owner));
    const periods = ["month", "month3", "year", "ytd", "all"] as const;
    const report: string[] = [];

    for (const owner of owners) {
      const ref = ownerRef(owner);
      if (!ref) continue;
      const filters = { ...defaultPerformanceFilters(payload), owner };

      for (const periodId of periods) {
        const refPct = ref[periodId];
        if (refPct == null) continue;
        const r = computePeriodResult(payload, filters, periodId);
        const delta =
          r.gainPct != null ? (r.gainPct - refPct).toFixed(2) : "—";
        report.push(
          `${owner} ${periodId}: app=${r.gainPct?.toFixed(2) ?? "—"}% disnat=${refPct}% Δ=${delta}`,
        );
      }
    }

    assert.ok(report.length > 0, "au moins un titulaire comparé");
    // Journalise pour revue manuelle / CI — ne bloque pas tant qu'on calibre.
    console.log("[disnat-benchmark]\n" + report.join("\n"));
  });

  test("au moins une période Yann dans la tolérance large", async () => {
    const payload = await getPerformanceIndicatorPayload();
    const yann = uniquePortfolioOwners(payload.accounts.map((a) => a.owner)).find(
      (o) => o.toLowerCase().includes("yann"),
    );
    assert.ok(yann);
    const filters = { ...defaultPerformanceFilters(payload), owner: yann };
    const ref = DISNAT_RETURNS_BENCHMARK.yann;

    let hits = 0;
    for (const periodId of ["month3", "ytd"] as const) {
      const r = computePeriodResult(payload, filters, periodId);
      if (r.gainPct == null) continue;
      if (Math.abs(r.gainPct - ref[periodId]) <= DISNAT_RETURN_TOLERANCE_PCT) {
        hits++;
      }
    }
    assert.ok(hits >= 1, "au moins month3 ou ytd proche de Disnat (±8 pts)");
  });
});
