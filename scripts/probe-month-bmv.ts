import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  aggregateSessionGainsForAccounts,
  resolvePeriodBounds,
  aggregateBmvTitresCad,
  titresCadAtPeriodEnd,
  titresCadFullCoverageAtOrBefore,
  disnatTitresMaterialKeys,
} from "@/features/portfolio/performance-indicator-logic";
import {
  resolvePeriodReturnPercent,
  computeTwrFromSessions,
} from "@/features/portfolio/performance-return-methods";

// re-export material keys - it's private, use inline
import type { PerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-types";

const AS_OF = "2026-06-15T14:07:00";

function materialKeys(
  payload: PerformanceIndicatorPayload,
  disnatKeys: string[],
  lookup: string,
  end: string,
) {
  const minBase = lookup; // simplified
  return disnatKeys.filter((k) => {
    if ((payload.currentByAccount[k]?.positionsCad ?? 0) > 0) return true;
    for (const pt of payload.historyPoints ?? []) {
      if (pt.accountKey === k && pt.asOf >= lookup && pt.asOf <= end) return true;
    }
    return false;
  });
}

async function probe(keys: string[], label: string) {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;
  const bounds = resolvePeriodBounds("month", new Date(AS_OF), 2026, null);
  const lookup = bounds.baselineLookup!;
  const sessions = aggregateSessionGainsForAccounts(payload, keys).filter(
    (g) => g.date >= bounds.start! && g.date <= bounds.end,
  );
  const mats = materialKeys(payload, keys.filter((k) => !k.startsWith("ext:")), lookup, bounds.end);
  const bmvAgg = aggregateBmvTitresCad(mats, payload, bounds.start!, lookup);
  const bmvFull = titresCadFullCoverageAtOrBefore(mats, payload, lookup);
  const emvPeriod = titresCadAtPeriodEnd(mats, payload, bounds.end);
  const emvFull = titresCadFullCoverageAtOrBefore(mats, payload, bounds.end);
  const ret = resolvePeriodReturnPercent({
    sessions,
    periodStart: bounds.start!,
    periodEnd: bounds.end,
    bmv: bmvAgg?.valueCad ?? null,
    emv: emvPeriod?.valueCad ?? null,
    boundaryCoverageComplete: bmvAgg != null && emvPeriod != null,
    flows: payload.cashFlows,
    accountKeys: mats,
  });
  const twr = computeTwrFromSessions(sessions, bounds.end, bounds.start!);
  console.log(
    label,
    `ret=${ret.gainPct?.toFixed(2)}%(${ret.algorithm}) twr=${twr.gainPct?.toFixed(2)}%`,
    `bmvAgg=${Math.round(bmvAgg?.valueCad ?? 0)} bmvFull=${Math.round(bmvFull?.valueCad ?? 0)}`,
    `emvPer=${Math.round(emvPeriod?.valueCad ?? 0)} emvFull=${Math.round(emvFull?.valueCad ?? 0)}`,
    `sessions=${sessions.length}`,
  );
}

async function main() {
  await probe(
    ["5KFZEZ2|CAD", "5KFZET5|USD", "5KFZEA9|CAD", "5KFZEB7|USD", "5KFZES7|USD", "5KFZE19|CAD", "5KFZEU3|USD", "5KFZEY4|CAD"],
    "Yann",
  );
  await probe(
    ["5L3APB3|USD", "5L3APA5|CAD", "5L3APU9|USD", "5L3APY0|CAD"],
    "Val",
  );
  await probe(["5L3APY0|CAD"], "Val Y0");
}

main().catch(console.error);
