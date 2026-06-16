import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  aggregateSessionGainsForAccounts,
  titresCadFullCoverageAtOrBefore,
} from "@/features/portfolio/performance-indicator-logic";
import {
  computeModifiedDietzReturn,
  computeTwrFromSessions,
  weightedExternalFlowsForDietz,
} from "@/features/portfolio/performance-return-methods";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";

const AS_OF = "2026-06-15T14:07:00";

async function tryBounds(
  payload: Awaited<ReturnType<typeof getPerformanceIndicatorPayload>>,
  keys: string[],
  start: string,
  end: string,
  label: string,
) {
  const sessions = aggregateSessionGainsForAccounts(payload, keys).filter(
    (g) => g.date >= start && g.date <= end,
  );
  const lookup = start; // simplified
  const bmv = titresCadFullCoverageAtOrBefore(keys, payload, lookup);
  const emv = titresCadFullCoverageAtOrBefore(keys, payload, end);
  const { sumFlows, weightedFlows } = weightedExternalFlowsForDietz(
    payload.cashFlows,
    keys,
    start,
    end,
  );
  const dietz = computeModifiedDietzReturn(
    bmv?.valueCad ?? 0,
    emv?.valueCad ?? 0,
    sumFlows,
    weightedFlows,
    start,
    end,
  );
  const twr = computeTwrFromSessions(sessions, end, start);
  console.log(
    label.padEnd(24),
    `${start}→${end}`,
    `dietz=${dietz.gainPct?.toFixed(2)}% twr=${twr.gainPct?.toFixed(2)}%`,
  );
}

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;
  const yann = uniquePortfolioOwners(payload.accounts.map((a) => a.owner)).find((o) =>
    o.toLowerCase().includes("yann"),
  )!;
  const val = uniquePortfolioOwners(payload.accounts.map((a) => a.owner)).find((o) =>
    o.toLowerCase().includes("valerie"),
  )!;
  const yKeys = payload.accounts.filter((a) => a.owner === yann && !a.isExternal).map((a) => a.accountKey);
  const vKeys = payload.accounts.filter((a) => a.owner === val && !a.isExternal).map((a) => a.accountKey);

  console.log("Yann ref month 6.51%");
  for (const [label, start, end] of [
    ["rolling subMonth", "2026-05-15", "2026-06-15"],
    ["calendar May", "2026-05-01", "2026-05-31"],
    ["21 sessions ~", "2026-05-19", "2026-06-15"],
    ["30 cal days", "2026-05-16", "2026-06-15"],
  ] as const) {
    await tryBounds(payload, yKeys, start, end, `Yann ${label}`);
  }

  console.log("\nVal ref month 6.41%");
  for (const [label, start, end] of [
    ["rolling subMonth", "2026-05-15", "2026-06-15"],
    ["calendar May", "2026-05-01", "2026-05-31"],
    ["Y0 only roll", "2026-05-15", "2026-06-15"],
  ] as const) {
    await tryBounds(payload, label.includes("Y0") ? ["5L3APY0|CAD"] : vKeys, start, end, `Val ${label}`);
  }
}

main().catch(console.error);
