import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import { resolveActiveAccountKeys, defaultPerformanceFilters } from "@/features/portfolio/performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";

const AS_OF = "2026-06-15T14:07:00";

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;
  const owner = uniquePortfolioOwners(payload.accounts.map((a) => a.owner)).find((o) =>
    o.toLowerCase().includes("valerie"),
  )!;
  const keys = resolveActiveAccountKeys(
    payload.accounts,
    "disnat",
    [],
    [],
    owner,
  );
  const keySet = new Set(keys);
  const flows = payload.cashFlows.filter(
    (f) => keySet.has(f.accountKey) && f.tradeDate >= "2026-01-01" && f.tradeDate <= "2026-06-15",
  );
  let total = 0;
  const byCat = new Map<string, number>();
  for (const f of flows) {
    total += f.amountCad;
    byCat.set(f.txCategory, (byCat.get(f.txCategory) ?? 0) + f.amountCad);
    console.log(f.tradeDate, f.accountKey, f.txCategory, Math.round(f.amountCad), f.amountCad > 0 ? "+" : "");
  }
  console.log("\nby category", Object.fromEntries(byCat));
  console.log("total flows YTD", Math.round(total));
}

main().catch(console.error);
