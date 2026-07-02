/**
 * Régression multi-périodes vs captures Disnat ($ et %).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getPerformanceIndicatorPayload } from "./performance-indicator-queries";
import {
  computePeriodResult,
  computeTitresPeriodGain,
  defaultPerformanceFilters,
  resolvePeriodBounds,
} from "./performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";
import {
  DISNAT_RETURNS_BENCHMARK,
  DISNAT_RETURN_TOLERANCE_PCT,
} from "./fixtures/disnat-returns-benchmark.fixture";

const hasDb = Boolean(process.env.DATABASE_URL);
const AS_OF = "2026-06-15T14:07:00";

const ACCOUNT_KEYS = [
  "5KFZEZ2|CAD",
  "5KFZET5|USD",
  "5KFZEY4|CAD",
  "5KFZEU3|USD",
  "5KFZES7|USD",
  "5L3APY0|CAD",
] as const;

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

  test("$ YTD par compte: cohérence interne (Δ titres − flux)", async () => {
    const payload = await getPerformanceIndicatorPayload();
    payload.asOfNow = AS_OF;
    const bounds = resolvePeriodBounds("ytd", new Date(AS_OF), 2026, null);

    for (const accountKey of ACCOUNT_KEYS) {
      const r = computePeriodResult(
        payload,
        {
          ...defaultPerformanceFilters(payload),
          preset: "custom",
          includedAccountKeys: [accountKey],
          excludedAccountKeys: [],
        },
        "ytd",
      );
      assert.ok(r.gainCad != null, `${accountKey} ytd gainCad null`);

      const titres = computeTitresPeriodGain([accountKey], payload, bounds, "ytd");
      assert.ok(titres.usable && titres.gainCad != null, `${accountKey} titres gainCad null`);
      assert.equal(
        r.gainCad,
        titres.gainCad,
        `${accountKey} ytd $ incohérent avec Δ titres − flux`,
      );
    }
  });

  test("$ YTD titulaire: agrégation cohérente des comptes", async () => {
    const payload = await getPerformanceIndicatorPayload();
    payload.asOfNow = AS_OF;
    const owners = uniquePortfolioOwners(payload.accounts.map((a) => a.owner));

    for (const owner of owners) {
      const ownerAccountKeys = payload.accounts
        .filter((a) => !a.isExternal && (a.owner ?? "") === owner)
        .map((a) => a.accountKey);
      if (ownerAccountKeys.length === 0) continue;

      const r = computePeriodResult(
        payload,
        { ...defaultPerformanceFilters(payload), owner, preset: "disnat" },
        "ytd",
      );
      assert.ok(r.gainCad != null, `${owner} ytd gainCad null`);

      let sumByAccount = 0;
      for (const accountKey of ownerAccountKeys) {
        const byAccount = computePeriodResult(
          payload,
          {
            ...defaultPerformanceFilters(payload),
            preset: "custom",
            includedAccountKeys: [accountKey],
            excludedAccountKeys: [],
          },
          "ytd",
        );
        sumByAccount += byAccount.gainCad ?? 0;
      }

      assert.ok(
        Math.abs((r.gainCad ?? 0) - sumByAccount) < 0.01,
        `${owner} ytd $ agrégé=${r.gainCad} vs somme comptes=${sumByAccount}`,
      );
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
