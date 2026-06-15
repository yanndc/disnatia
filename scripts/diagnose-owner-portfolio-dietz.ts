import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResult,
  defaultPerformanceFilters,
  resolveActiveAccountKeys,
  resolvePeriodBounds,
  titresCadFullCoverageAtOrBefore,
} from "@/features/portfolio/performance-indicator-logic";
import {
  gainCadFromPeriodReturn,
  resolvePeriodReturnPercent,
} from "@/features/portfolio/performance-return-methods";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";

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
  const sessions = (payload.sessionGainsByDate ?? []).filter(
    (g) => g.date >= bounds.start! && g.date <= bounds.end,
  );
  const bmv = titresCadFullCoverageAtOrBefore(keys, payload, lookup);
  const emv = titresCadFullCoverageAtOrBefore(keys, payload, bounds.end);
  const ret = resolvePeriodReturnPercent({
    sessions,
    periodStart: bounds.start!,
    periodEnd: bounds.end,
    bmv: bmv?.valueCad ?? null,
    emv: emv?.valueCad ?? null,
    boundaryCoverageComplete: bmv != null && emv != null,
    flows: payload.cashFlows,
    accountKeys: keys,
  });
  const fromPct = gainCadFromPeriodReturn(ret, bounds.start!, bounds.end);
  const r = computePeriodResult(payload, filters, "ytd");

  console.log("BMV", Math.round(bmv?.valueCad ?? 0), "EMV", Math.round(emv?.valueCad ?? 0));
  console.log("%", ret.gainPct?.toFixed(2), "algo", ret.algorithm);
  console.log("$ from %", Math.round(fromPct ?? 0));
  console.log("$ app", Math.round(r.gainCad ?? 0));
  console.log("disnat $298 %13.49");
}

main().catch(console.error);
