import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  resolvePeriodBounds,
  titresCadFullCoverageAtOrBefore,
} from "@/features/portfolio/performance-indicator-logic";
import { netExternalFlowsCad } from "@/features/portfolio/performance-cash-flows";
import { cashCadAtOrBefore } from "@/features/portfolio/performance-cash-ledger";

const KEYS = ["5KFZEZ2|CAD", "5L3APY0|CAD"] as const;
const DISNAT: Record<string, { month3: number; ytd: number }> = {
  "5KFZEZ2|CAD": { month3: 435, ytd: -165.19 },
  "5L3APY0|CAD": { month3: 48.02, ytd: 315.52 },
};
const AS_OF = "2026-06-12T15:00:00";

function importSnapshotCad(
  accountKey: string,
  payload: Awaited<ReturnType<typeof getPerformanceIndicatorPayload>>,
  targetDate: string,
): { asOf: string; valueCad: number } | null {
  let best: { asOf: string; valueCad: number } | null = null;
  for (const pt of payload.snapshots ?? []) {
    if (pt.accountKey !== accountKey || pt.asOf > targetDate) continue;
    const valueCad =
      pt.currency.toUpperCase() === "USD" && payload.usdToCad
        ? pt.totalValueNative * payload.usdToCad
        : pt.totalValueNative;
    if (!best || pt.asOf > best.asOf) best = { asOf: pt.asOf, valueCad };
  }
  return best;
}

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;

  for (const KEY of KEYS) {
    for (const period of ["month3", "ytd"] as const) {
      const bounds = resolvePeriodBounds(period, new Date(AS_OF), 2026, null);
      const lookup = bounds.baselineLookup!;
      const titresBmv = titresCadFullCoverageAtOrBefore([KEY], payload, lookup);
      const titresEmv = titresCadFullCoverageAtOrBefore([KEY], payload, bounds.end);
      const snapBmv = importSnapshotCad(KEY, payload, lookup);
      const snapEmv = importSnapshotCad(KEY, payload, bounds.end);
      const cashBmv = cashCadAtOrBefore([KEY], payload.accountCashLedgers, lookup);
      const cashEmv = cashCadAtOrBefore([KEY], payload.accountCashLedgers, bounds.end);
      const cur = payload.currentByAccount[KEY];
      const flows = netExternalFlowsCad(
        payload.cashFlows,
        [KEY],
        bounds.start!,
        bounds.end,
      );
      const sumSess = (payload.sessionGainsByAccount?.[KEY] ?? [])
        .filter((g) => g.date >= bounds.start! && g.date <= bounds.end)
        .reduce((s, g) => s + g.gainCad, 0);

      const disnatRef = DISNAT[KEY]![period];
      const titresGain =
        titresEmv && titresBmv
          ? titresEmv.valueCad - titresBmv.valueCad - flows
          : null;
      const totalBmv = (titresBmv?.valueCad ?? 0) + cashBmv;
      const totalEmv = (cur?.positionsCad ?? 0) + cashEmv;
      const totalGain = totalEmv - totalBmv - flows;
      const snapGain =
        snapBmv && snapEmv ? snapEmv.valueCad - snapBmv.valueCad - flows : null;

      console.log(`\n=== ${KEY} ${period} (lookup ${lookup}) ===`);
      console.log(`titres BMV/EMV: ${titresBmv?.valueCad.toFixed(0)} / ${titresEmv?.valueCad.toFixed(0)} → gain ${titresGain?.toFixed(0)}`);
      console.log(`cash BMV/EMV: ${cashBmv.toFixed(0)} / ${cashEmv.toFixed(0)}`);
      console.log(`total (titres+cash ledger): ${totalBmv.toFixed(0)} → ${totalEmv.toFixed(0)} → gain ${totalGain.toFixed(0)}`);
      console.log(`import snap: ${snapBmv?.valueCad.toFixed(0) ?? "—"}@${snapBmv?.asOf} → ${snapEmv?.valueCad.toFixed(0) ?? "—"}@${snapEmv?.asOf} → gain ${snapGain?.toFixed(0) ?? "—"}`);
      console.log(`state import totalCad: ${cur?.totalCad.toFixed(0)} (pos ${cur?.positionsCad.toFixed(0)} + cash ${cur?.cashCad.toFixed(0)})`);
      console.log(`Σ sessions: ${sumSess.toFixed(0)} | Disnat: ${disnatRef}`);
    }
  }
}

main().catch(console.error);
