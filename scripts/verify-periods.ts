import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computeAllPeriodResults,
  computeAllPeriodResultsWithSnapshots,
  defaultPerformanceFilters,
} from "@/features/portfolio/performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";

const AS_OF = "2026-06-15T14:40:00";

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;

  for (const owner of uniquePortfolioOwners(payload.accounts.map((a) => a.owner))) {
    if (!owner.toLowerCase().includes("yann") && !owner.toLowerCase().includes("valerie"))
      continue;
    const filters = { ...defaultPerformanceFilters(payload), owner, preset: "disnat" as const };
    console.log("\n===", owner.split(" ")[0], "LIVE ===");
    for (const r of computeAllPeriodResults(payload, filters)) {
      if (["month", "month3", "year", "ytd"].includes(r.periodId)) {
        console.log(r.periodId, "$", Math.round(r.gainCad ?? 0), "pct", r.gainPct?.toFixed(1));
      }
    }
    console.log("--- SNAPSHOTS ---");
    for (const r of computeAllPeriodResultsWithSnapshots(payload, filters)) {
      if (["month", "month3", "year", "ytd"].includes(r.periodId)) {
        console.log(r.periodId, "$", Math.round(r.gainCad ?? 0), "pct", r.gainPct?.toFixed(1));
      }
    }
  }
}

main().catch(console.error);
