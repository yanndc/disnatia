import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  aggregateSessionGainsForAccounts,
  titresCadFullCoverageAtOrBefore,
  resolvePeriodBounds,
} from "@/features/portfolio/performance-indicator-logic";
import {
  computeModifiedDietzReturn,
  computeTwrFromSessions,
  weightedExternalFlowsForDietz,
} from "@/features/portfolio/performance-return-methods";
import { netExternalFlowsCad, dedupeNearDuplicateFlows } from "@/features/portfolio/performance-cash-flows";

const AS_OF = "2026-06-15T14:07:00";

async function dietz(keys: string[], period: "month" | "ytd", flows: typeof deduped) {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;
  const bounds = resolvePeriodBounds(period, new Date(AS_OF), 2026, null);
  const sessions = aggregateSessionGainsForAccounts(payload, keys).filter(
    (g) => g.date >= bounds.start! && g.date <= bounds.end,
  );
  const bmv = titresCadFullCoverageAtOrBefore(keys, payload, bounds.baselineLookup!);
  const emv = titresCadFullCoverageAtOrBefore(keys, payload, bounds.end);
  const { sumFlows, weightedFlows } = weightedExternalFlowsForDietz(
    flows,
    keys,
    bounds.start!,
    bounds.end,
  );
  const dietz = computeModifiedDietzReturn(
    bmv?.valueCad ?? 0,
    emv?.valueCad ?? 0,
    sumFlows,
    weightedFlows,
    bounds.start!,
    bounds.end,
  );
  const twr = computeTwrFromSessions(sessions, bounds.end, bounds.start!);
  return { dietz: dietz.gainPct, twr: twr.gainPct, bmv: bmv?.valueCad, emv: emv?.valueCad, flows: sumFlows };
}

const deduped = dedupeNearDuplicateFlows(
  (await getPerformanceIndicatorPayload()).cashFlows,
);

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const flows = dedupeNearDuplicateFlows(payload.cashFlows);

  const scopes = {
    all4: ["5L3APB3|USD", "5L3APA5|CAD", "5L3APU9|USD", "5L3APY0|CAD"],
    titres2: ["5L3APU9|USD", "5L3APY0|CAD"],
    y0: ["5L3APY0|CAD"],
  };

  for (const [name, keys] of Object.entries(scopes)) {
    for (const p of ["month", "ytd"] as const) {
      const r = await dietz(keys, p, flows);
      const ref = p === "month" ? 6.41 : 13.72;
      console.log(
        name,
        p,
        `dietz=${r.dietz?.toFixed(2)}% twr=${r.twr?.toFixed(2)}% flows=${Math.round(r.flows)} ref=${ref}%`,
      );
    }
  }
}

main().catch(console.error);
