import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  buildPerformanceCashFlowsFromTxRows,
  dedupeNearDuplicateFlows,
  netExternalFlowsCad,
} from "@/features/portfolio/performance-cash-flows";
import { prisma } from "@/lib/db/prisma";
import {
  computeModifiedDietzReturn,
  weightedExternalFlowsForDietz,
} from "@/features/portfolio/performance-return-methods";
import {
  resolvePeriodBounds,
  titresCadFullCoverageAtOrBefore,
  resolveActiveAccountKeys,
  defaultPerformanceFilters,
} from "@/features/portfolio/performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";

const AS_OF = "2026-06-15T14:07:00";

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;
  const owner = uniquePortfolioOwners(payload.accounts.map((a) => a.owner)).find((o) =>
    o.toLowerCase().includes("valerie"),
  )!;
  const keys = resolveActiveAccountKeys(payload.accounts, "disnat", [], [], owner);

  const txRows = await prisma.portfolioTransactionLine.findMany({
    where: {
      accountKey: { in: keys },
      txCategory: { in: ["CONTRIBUTION", "TRANSFER_IN", "TRANSFER_OUT", "INTERNAL_TRANSFER"] },
    },
    select: {
      accountKey: true,
      tradeDate: true,
      settlementDate: true,
      txCategory: true,
      amount: true,
      currency: true,
      fingerprint: true,
    },
  });

  const built = buildPerformanceCashFlowsFromTxRows(txRows, payload.usdToCad);
  const forcedDedup = dedupeNearDuplicateFlows(built);
  const bounds = resolvePeriodBounds("ytd", new Date(AS_OF), 2026, null);
  const bmv = titresCadFullCoverageAtOrBefore(keys, payload, bounds.baselineLookup!);
  const emv = titresCadFullCoverageAtOrBefore(keys, payload, bounds.end);

  for (const [label, flows] of [
    ["built", built],
    ["forcedDedup", forcedDedup],
  ] as const) {
    const net = netExternalFlowsCad(flows, keys, bounds.start!, bounds.end);
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
    console.log(
      label,
      "count",
      flows.filter((f) => f.tradeDate >= bounds.start! && f.tradeDate <= bounds.end).length,
      "net",
      Math.round(net),
      "dietz%",
      dietz.gainPct?.toFixed(2),
    );
  }

  console.log("\nY0 built flows:");
  for (const f of built.filter((f) => f.accountKey === "5L3APY0|CAD" && f.tradeDate >= "2026-01-01")) {
    console.log(f.tradeDate, Math.round(f.amountCad));
  }
}

main().catch(console.error);
