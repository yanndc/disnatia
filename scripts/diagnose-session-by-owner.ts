import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResult,
  defaultPerformanceFilters,
  resolveActiveAccountKeys,
} from "@/features/portfolio/performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";

const fmt = (n: number) => n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const owners = uniquePortfolioOwners(payload.accounts.map((a) => a.owner));

  for (const owner of owners) {
    const filters = { ...defaultPerformanceFilters(payload), owner };
    const keys = resolveActiveAccountKeys(
      payload.accounts,
      filters.preset,
      filters.includedAccountKeys,
      filters.excludedAccountKeys,
      filters.owner,
    ).filter((k) => !k.startsWith("ext:"));
    const day = computePeriodResult(payload, filters, "day");
    console.log(owner, "| séance", fmt(day.gainCad ?? 0), "| comptes", keys.length);
  }

  const all = computePeriodResult(payload, defaultPerformanceFilters(payload), "day");
  console.log("TOUS", "| séance", fmt(all.gainCad ?? 0));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
