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

  for (const owner of ["ALL", ...owners]) {
    const base = defaultPerformanceFilters(payload);
    const filters =
      owner === "ALL"
        ? base
        : {
            ...base,
            preset: "custom" as const,
            owner,
            includedAccountKeys: payload.accounts
              .filter((a) => a.owner === owner && !a.isExternal)
              .map((a) => a.accountKey),
          };
    const keys = resolveActiveAccountKeys(
      payload.accounts,
      filters.preset,
      filters.includedAccountKeys,
      filters.excludedAccountKeys,
      filters.owner,
    ).filter((k) => !k.startsWith("ext:"));
    const positions = keys.reduce(
      (s, k) => s + (payload.currentByAccount[k]?.positionsCad ?? 0),
      0,
    );
    const month = computePeriodResult(payload, filters, "month");
    const prec = computePeriodResult(payload, filters, "yesterday");
    console.log(
      owner,
      "| comptes",
      keys.length,
      "| titres",
      fmt(positions),
      "| mois",
      fmt(month.gainCad ?? 0),
      month.gainPct?.toFixed(1) + "%",
      "| préc",
      fmt(prec.gainCad ?? 0),
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
