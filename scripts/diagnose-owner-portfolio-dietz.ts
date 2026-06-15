import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  aggregateBmvTitresCad,
  computeTitresPeriodGain,
  defaultPerformanceFilters,
  resolvePeriodBounds,
  titresCadAtPeriodEnd,
  titresCadFullCoverageAtOrBefore,
} from "@/features/portfolio/performance-indicator-logic";
import { netExternalFlowsCad } from "@/features/portfolio/performance-cash-flows";
import { weightedExternalFlowsForDietz } from "@/features/portfolio/performance-return-methods";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";
import { resolveActiveAccountKeys } from "@/features/portfolio/performance-indicator-logic";

const AS_OF = "2026-06-12T15:00:00";

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;
  const bounds = resolvePeriodBounds("ytd", new Date(AS_OF), 2026, null);
  const yann = uniquePortfolioOwners(payload.accounts.map((a) => a.owner)).find(
    (o) => o.toLowerCase().includes("yann"),
  )!;
  const filters = { ...defaultPerformanceFilters(payload), owner: yann, preset: "disnat" as const };
  const keys = resolveActiveAccountKeys(
    payload.accounts,
    filters.preset,
    filters.includedAccountKeys,
    filters.excludedAccountKeys,
    filters.owner,
  );
  const lookup = bounds.baselineLookup!;

  const bmv =
    aggregateBmvTitresCad(keys, payload, bounds.start!, lookup) ??
    titresCadFullCoverageAtOrBefore(keys, payload, lookup);
  const emv = titresCadAtPeriodEnd(keys, payload, bounds.end);
  const flows = netExternalFlowsCad(
    payload.cashFlows,
    keys,
    bounds.start!,
    bounds.end,
  );
  const wFlows = weightedExternalFlowsForDietz(
    payload.cashFlows,
    keys,
    bounds.start!,
    bounds.end,
  );
  const titres = computeTitresPeriodGain(keys, payload, bounds, "ytd");

  console.log("keys", keys.length);
  console.log("BMV", Math.round(bmv?.valueCad ?? 0), "@", bmv?.asOf);
  console.log("EMV", Math.round(emv?.valueCad ?? 0), "@", emv?.asOf);
  console.log("flux nets", Math.round(flows));
  console.log("flux pondérés", Math.round(wFlows.sumFlows));
  console.log(
    "EMV-BMV-flux",
    Math.round((emv?.valueCad ?? 0) - (bmv?.valueCad ?? 0) - flows),
  );
  console.log(
    "Dietz num",
    Math.round(
      (emv?.valueCad ?? 0) - (bmv?.valueCad ?? 0) - wFlows.sumFlows,
    ),
  );
  console.log("titresCalc gain", Math.round(titres.gainCad ?? 0));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
