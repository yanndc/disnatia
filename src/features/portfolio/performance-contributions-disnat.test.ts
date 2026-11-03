/**
 * Vérifie que les cotisations (settlementDate) sont chargées, dédupliquées et soustraites du gain $.
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
import { netExternalFlowsCad } from "./performance-cash-flows";

const hasDb = Boolean(process.env.DATABASE_URL);
const AS_OF = "2026-06-12T15:00:00";

const DISNAT_YTD_DOLLARS = {
  "5KFZEZ2|CAD": -165.19,
  "5L3APY0|CAD": 315.52,
} as const;

/** AAJ attendu après correction du plancher BMV « neutre des apports » (audit 2026-11). */
const EXPECTED_YTD_DOLLARS: Record<string, number> = {
  // Avant : −8 759 $ (BMV remplacé par l'import du 5 mai). Après : ≈ +3 333 $.
  "5KFZEZ2|CAD": 3_333,
};

/** Avant correction : Σ session_gains YTD sans déduction des cotisations. */
const SESSION_CHAIN_YTD_WITHOUT_FLOWS = {
  "5KFZEZ2|CAD": 4318,
  "5L3APY0|CAD": 9950,
} as Record<string, number>;

describe("Cotisations — chargement et gain $ vs Disnat", { skip: !hasDb }, () => {
  test("cashFlows inclut les comptes CELI/REER avec settlementDate", async () => {
    const payload = await getPerformanceIndicatorPayload();
    for (const key of Object.keys(DISNAT_YTD_DOLLARS)) {
      const flows = payload.cashFlows.filter((f) => f.accountKey === key);
      assert.ok(
        flows.length > 0,
        `${key} : aucun flux chargé (attendu cotisations avec settlementDate)`,
      );
    }
  });

  test("flux YTD dédupliqués (pas de double comptage réimport)", async () => {
    const payload = await getPerformanceIndicatorPayload();
    payload.asOfNow = AS_OF;
    const bounds = resolvePeriodBounds("ytd", new Date(AS_OF), 2026, null);

    for (const key of Object.keys(DISNAT_YTD_DOLLARS)) {
      const flows = netExternalFlowsCad(
        payload.cashFlows,
        [key],
        bounds.start!,
        bounds.end,
      );
      assert.ok(
        flows > 0 && flows < 20_000,
        `${key} : flux YTD=${Math.round(flows)} — attendu cotisations uniques (pas ~2×)`,
      );
    }
  });

  test("gain $ = EMV − BMV − flux (cotisations soustraites)", async () => {
    const payload = await getPerformanceIndicatorPayload();
    payload.asOfNow = AS_OF;
    const bounds = resolvePeriodBounds("ytd", new Date(AS_OF), 2026, null);

    for (const key of Object.keys(DISNAT_YTD_DOLLARS)) {
      const titres = computeTitresPeriodGain([key], payload, bounds, "ytd");
      assert.ok(titres.usable && titres.gainCad != null, `${key} titres gain`);

      const r = computePeriodResult(
        payload,
        {
          ...defaultPerformanceFilters(payload),
          preset: "custom",
          includedAccountKeys: [key],
          excludedAccountKeys: [],
        },
        "ytd",
      );
      assert.equal(r.gainCad, titres.gainCad, `${key} gain $ incohérent avec Δ titres − flux`);

      const withoutFlows = SESSION_CHAIN_YTD_WITHOUT_FLOWS[key];
      assert.notEqual(
        Math.round(r.gainCad!),
        withoutFlows,
        `${key} : gain $ identique à Σ séances sans flux (${withoutFlows})`,
      );
      assert.equal(
        Math.sign(r.gainCad!),
        Math.sign(r.gainPct!),
        `${key} : $ et % doivent être de même signe (${Math.round(r.gainCad!)} $ vs ${r.gainPct?.toFixed(2)} %)`,
      );
      assert.ok(
        r.baselineCad != null && r.baselineCad > 0,
        `${key} : base du % indisponible`,
      );
      assert.ok(
        Math.abs((r.gainPct! / 100) * r.baselineCad! - r.gainCad!) <=
          Math.max(1, Math.abs(r.gainCad!) * 0.01),
        `${key} : $=${Math.round(r.gainCad!)} incohérent avec %×base=${Math.round(
          (r.gainPct! / 100) * r.baselineCad!,
        )}`,
      );
    }
  });

  test("YTD plus proche de Disnat que l ancienne méthode (sans flux)", async () => {
    const payload = await getPerformanceIndicatorPayload();
    payload.asOfNow = AS_OF;

    for (const [accountKey, disnatYtd] of Object.entries(DISNAT_YTD_DOLLARS)) {
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
      assert.ok(r.gainCad != null, `${accountKey} gainCad null`);

      const delta = Math.abs(r.gainCad - disnatYtd);
      const oldDelta = Math.abs(
        SESSION_CHAIN_YTD_WITHOUT_FLOWS[accountKey] - disnatYtd,
      );
      assert.ok(
        delta < oldDelta,
        `${accountKey} : pas plus proche de Disnat (avant Δ=${Math.round(oldDelta)}, maintenant Δ=${Math.round(delta)})`,
      );

      const expected = EXPECTED_YTD_DOLLARS[accountKey];
      if (expected != null) {
        assert.ok(
          Math.abs(r.gainCad - expected) <= 600,
          `${accountKey} : AAJ hors plage attendue (${Math.round(r.gainCad)} $, attendu ≈ ${expected} $)`,
        );
      }
    }
  });
});
