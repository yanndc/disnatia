import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResult,
  defaultPerformanceFilters,
  resolveActiveAccountKeys,
  resolvePeriodBounds,
  titresCadFullCoverageAtOrBefore,
  aggregateSessionGainsForAccounts,
} from "@/features/portfolio/performance-indicator-logic";
import {
  computeModifiedDietzReturn,
  computeTwrFromSessions,
  weightedExternalFlowsForDietz,
} from "@/features/portfolio/performance-return-methods";
import { netExternalFlowsCad } from "@/features/portfolio/performance-cash-flows";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";
import { DISNAT_RETURNS_BENCHMARK } from "@/features/portfolio/fixtures/disnat-returns-benchmark.fixture";

const AS_OF = "2026-06-15T14:07:00";
const PERIODS = ["month", "month3", "year", "ytd"] as const;

function pctFromGain(gain: number, base: number): number | null {
  return base > 0 ? (gain / base) * 100 : null;
}

async function probeOwner(
  payload: Awaited<ReturnType<typeof getPerformanceIndicatorPayload>>,
  owner: string,
  ref: (typeof DISNAT_RETURNS_BENCHMARK)["valerie"],
) {
  const filters = { ...defaultPerformanceFilters(payload), owner, preset: "disnat" as const };
  const keys = resolveActiveAccountKeys(
    payload.accounts,
    filters.preset,
    filters.includedAccountKeys,
    filters.excludedAccountKeys,
    filters.owner,
  );

  console.log(`\n========== ${owner} keys=${keys.join(", ")} ==========`);

  for (const periodId of PERIODS) {
    const r = computePeriodResult(payload, filters, periodId);
    const bounds = resolvePeriodBounds(periodId, new Date(AS_OF), 2026, null);
    const lookup = bounds.baselineLookup!;
    const sessions = aggregateSessionGainsForAccounts(payload, keys).filter(
      (g) => g.date >= bounds.start! && g.date <= bounds.end,
    );
    const bmv = titresCadFullCoverageAtOrBefore(keys, payload, lookup);
    const emv = titresCadFullCoverageAtOrBefore(keys, payload, bounds.end);
    const flows = netExternalFlowsCad(payload.cashFlows, keys, bounds.start!, bounds.end);
    const { sumFlows, weightedFlows } = weightedExternalFlowsForDietz(
      payload.cashFlows,
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
    const firstPrior = sessions[0]?.priorCad ?? 0;
    const simpleGainOverBmv = pctFromGain(r.gainCad ?? 0, bmv?.valueCad ?? 0);
    const simpleGainOverFirstPrior = pctFromGain(r.gainCad ?? 0, firstPrior);
    const disnatRef = ref[periodId];

    console.log(`\n${periodId} app=$${Math.round(r.gainCad ?? 0)} app%=${r.gainPct?.toFixed(2)} disnat%=${disnatRef}`);
    console.log(`  BMV=${Math.round(bmv?.valueCad ?? 0)} EMV=${Math.round(emv?.valueCad ?? 0)} flows=${Math.round(flows)}`);
    console.log(`  dietz=${dietz.gainPct?.toFixed(2)}% twr=${twr.gainPct?.toFixed(2)}% algo=${r.method}`);
    console.log(`  gain/BMV=${simpleGainOverBmv?.toFixed(2)}% gain/firstPrior=${simpleGainOverFirstPrior?.toFixed(2)}%`);
  }
}

async function probeAccount(
  payload: Awaited<ReturnType<typeof getPerformanceIndicatorPayload>>,
  accountKey: string,
) {
  const filters = {
    ...defaultPerformanceFilters(payload),
    preset: "custom" as const,
    includedAccountKeys: [accountKey],
    excludedAccountKeys: [],
  };
  const r = computePeriodResult(payload, filters, "ytd");
  const bounds = resolvePeriodBounds("ytd", new Date(AS_OF), 2026, null);
  const sessions = (payload.sessionGainsByAccount?.[accountKey] ?? []).filter(
    (g) => g.date >= bounds.start!,
  );
  const firstPrior = sessions[0]?.priorCad ?? 0;
  const sumGain = sessions.reduce((s, g) => s + g.gainCad, 0);
  console.log(
    `\n${accountKey} ytd $${Math.round(r.gainCad ?? 0)} %${r.gainPct?.toFixed(2)} | sessions=${sessions.length} firstPrior=${Math.round(firstPrior)} sumGain=${Math.round(sumGain)}`,
  );
  console.log(
    `  gain/firstPrior=${pctFromGain(r.gainCad ?? 0, firstPrior)?.toFixed(2)}% gain/sumPrior=${pctFromGain(sumGain, firstPrior)?.toFixed(2)}%`,
  );
}

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;

  for (const owner of uniquePortfolioOwners(payload.accounts.map((a) => a.owner))) {
    const lower = owner.toLowerCase();
    const ref = lower.includes("yann")
      ? DISNAT_RETURNS_BENCHMARK.yann
      : lower.includes("valerie")
        ? DISNAT_RETURNS_BENCHMARK.valerie
        : null;
    if (!ref) continue;
    await probeOwner(payload, owner, ref);
  }

  for (const key of ["5L3APY0|CAD", "5L3APU9|USD", "5KFZEU3|USD"]) {
    await probeAccount(payload, key);
  }
}

main().catch(console.error);
