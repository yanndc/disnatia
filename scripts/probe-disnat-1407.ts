/**
 * Rétro-ingénierie formule Disnat $ YTD — capture 2026-06-15 14:07.
 * Teste plusieurs candidats et retient celui qui minimise l'écart global.
 */
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  resolvePeriodBounds,
  titresCadFullCoverageAtOrBefore,
} from "@/features/portfolio/performance-indicator-logic";
import { netExternalFlowsCad } from "@/features/portfolio/performance-cash-flows";
import { cashCadAtOrBefore } from "@/features/portfolio/performance-cash-ledger";
import type { PerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-types";

const AS_OF = "2026-06-15T14:07:00";

/** Gain YTD Disnat (devise du compte). */
const DISNAT_YTD: Record<string, number> = {
  "5KFZEZ2|CAD": 137.01,
  "5KFZET5|USD": 45.1,
  "5KFZEY4|CAD": -1.28,
  "5KFZEU3|USD": 1240.8,
  "5KFZE19|CAD": 0,
  "5KFZES7|USD": 592.78,
  "5L3APY0|CAD": 1038.5,
};

/** Valeur titres Disnat (excel 14:07, native). */
const DISNAT_TITRES: Record<string, number> = {
  "5KFZEZ2|CAD": 28935.74,
  "5KFZET5|USD": 1487.78,
  "5KFZEY4|CAD": 14876.15,
  "5KFZEU3|USD": 58241.85,
  "5KFZES7|USD": 31791.98,
  "5L3APY0|CAD": 59499.52,
};

function snapAtOrBefore(
  accountKey: string,
  payload: PerformanceIndicatorPayload,
  targetDate: string,
  field: "total" | "market",
): { asOf: string; native: number } | null {
  let best: { asOf: string; native: number } | null = null;
  for (const pt of payload.snapshots ?? []) {
    if (pt.accountKey !== accountKey || pt.asOf > targetDate) continue;
    const native =
      field === "market"
        ? (pt.marketValueNative ?? pt.totalValueNative)
        : pt.totalValueNative;
    if (!best || pt.asOf > best.asOf) best = { asOf: pt.asOf, native };
  }
  return best;
}

function toNativeCad(
  native: number,
  currency: string,
  fx: number | null,
): number {
  return currency.toUpperCase().includes("USD") && fx ? native * fx : native;
}

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;
  const bounds = resolvePeriodBounds("ytd", new Date(AS_OF), 2026, null);
  const lookup = bounds.baselineLookup!;
  const fx = payload.usdToCad;

  console.log("baselineLookup", lookup, "fx", fx?.toFixed(4));

  for (const [key, disnatGain] of Object.entries(DISNAT_YTD)) {
    const acc = payload.accounts.find((a) => a.accountKey === key);
    const cur = acc?.currency ?? "CAD";
    const isUsd = cur.toUpperCase().includes("USD");
    const flowsCad = netExternalFlowsCad(
      payload.cashFlows,
      [key],
      bounds.start!,
      bounds.end,
    );
    const flowsNative = isUsd && fx ? flowsCad / fx : flowsCad;

    const histBmv = titresCadFullCoverageAtOrBefore([key], payload, lookup);
    const histEmv = titresCadFullCoverageAtOrBefore([key], payload, bounds.end);
    const snapBmvTotal = snapAtOrBefore(key, payload, lookup, "total");
    const snapBmvMarket = snapAtOrBefore(key, payload, lookup, "market");
    const snapEmvTotal = snapAtOrBefore(key, payload, bounds.end, "total");
    const snapEmvMarket = snapAtOrBefore(key, payload, bounds.end, "market");
    const cashBmv = cashCadAtOrBefore([key], payload.accountCashLedgers, lookup);
    const cashEmv = cashCadAtOrBefore([key], payload.accountCashLedgers, bounds.end);

    const sessions = (payload.sessionGainsByAccount?.[key] ?? []).filter(
      (g) => g.date >= bounds.start!,
    );
    const sumSessCad = sessions.reduce((a, g) => a + g.gainCad, 0);
    const firstSess = sessions[0];

    const disnatTitres = DISNAT_TITRES[key];
    const impliedBmvNative =
      disnatTitres != null ? disnatTitres - disnatGain - flowsNative : null;

    const candidates: [string, number | null][] = [
      [
        "histTitres EMV-BMV-flux (CAD)",
        histEmv && histBmv ? histEmv.valueCad - histBmv.valueCad - flowsCad : null,
      ],
      [
        "snapTotal EMV-BMV-flux (CAD)",
        snapEmvTotal && snapBmvTotal
          ? toNativeCad(snapEmvTotal.native, cur, fx) -
            toNativeCad(snapBmvTotal.native, cur, fx) -
            flowsCad
          : null,
      ],
      [
        "snapMarket EMV-BMV-flux (CAD)",
        snapEmvMarket && snapBmvMarket
          ? toNativeCad(snapEmvMarket.native, cur, fx) -
            toNativeCad(snapBmvMarket.native, cur, fx) -
            flowsCad
          : null,
      ],
      [
        "disnatTitres - histBmvNative - flux",
        disnatTitres != null && histBmv
          ? disnatTitres -
            (isUsd && fx ? histBmv.valueCad / fx : histBmv.valueCad) -
            flowsNative
          : null,
      ],
      [
        "disnatTitres - snapMarketBmv - flux",
        disnatTitres != null && snapBmvMarket
          ? disnatTitres - snapBmvMarket.native - flowsNative
          : null,
      ],
      [
        "disnatTitres - snapTotalBmv - flux",
        disnatTitres != null && snapBmvTotal
          ? disnatTitres - snapBmvTotal.native - flowsNative
          : null,
      ],
      [
        "disnatTitres - impliedBmv (reverse)",
        disnatTitres != null && impliedBmvNative != null
          ? disnatTitres - impliedBmvNative - flowsNative
          : null,
      ],
      ["Σ sessions CAD", sumSessCad],
      [
        "Σ sessions native",
        isUsd && fx ? sumSessCad / fx : sumSessCad,
      ],
      [
        "titres+cash hist (CAD)",
        histEmv && histBmv
          ? histEmv.valueCad +
            cashEmv -
            (histBmv.valueCad + cashBmv) -
            flowsCad
          : null,
      ],
    ];

    console.log(`\n=== ${key} disnat=${disnatGain} ${isUsd ? "USD" : "CAD"} ===`);
    console.log(
      `  flux=${flowsNative.toFixed(0)} | histBMV=${histBmv?.valueCad.toFixed(0)} histEMV=${histEmv?.valueCad.toFixed(0)}`,
    );
    console.log(
      `  snapBMV market=${snapBmvMarket?.native.toFixed(0)}@${snapBmvMarket?.asOf} total=${snapBmvTotal?.native.toFixed(0)}@${snapBmvTotal?.asOf}`,
    );
    console.log(
      `  1re séance prior=${firstSess?.priorCad.toFixed(0)} date=${firstSess?.date}`,
    );
    if (impliedBmvNative != null) {
      console.log(`  BMV implicite Disnat (titres-flux-gain)=${impliedBmvNative.toFixed(2)}`);
    }

    let best = { name: "", delta: Infinity, val: 0 };
    for (const [name, val] of candidates) {
      if (val == null || !Number.isFinite(val)) continue;
      const compareVal = isUsd && fx && name.includes("(CAD)") ? val / fx : val;
      const delta = Math.abs(compareVal - disnatGain);
      const mark = delta < 50 ? " ✓✓" : delta < 200 ? " ✓" : "";
      console.log(
        `  ${name.padEnd(32)} ${compareVal.toFixed(0).padStart(8)} Δ=${delta.toFixed(0)}${mark}`,
      );
      if (delta < best.delta) best = { name, delta, val: compareVal };
    }
    console.log(`  → meilleur: ${best.name} (Δ=${best.delta.toFixed(0)})`);
  }
}

main().catch(console.error);
