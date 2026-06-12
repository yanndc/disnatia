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

/** Avant correction : Σ session_gains YTD sans déduction des cotisations. */
const SESSION_CHAIN_YTD_WITHOUT_FLOWS = {
  "5KFZEZ2|CAD": 4318,
  "5L3APY0|CAD": 9950,
} as const;

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
      const titres = computeTitresPeriodGain([key], payload, bounds);
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
      assert.ok(
        Math.abs(r.gainCad! - withoutFlows) > 1000,
        `${key} : gain $=${Math.round(r.gainCad!)} encore proche de Σ séances (${withoutFlows})`,
      );
    }
  });

  test("YTD proche capture Disnat ($)", async () => {
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

      assert.ok(
        delta < 500,
        `${accountKey} YTD $=${Math.round(r.gainCad)} vs disnat=${disnatYtd} (Δ=${Math.round(delta)})`,
      );
    }
  });
});
