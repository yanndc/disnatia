import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResult,
  defaultPerformanceFilters,
  resolvePeriodBounds,
} from "@/features/portfolio/performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";

const AS_OF = "2026-06-12T15:00:00";

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;
  const bounds = resolvePeriodBounds("ytd", new Date(AS_OF), 2026, null);
  const yann = uniquePortfolioOwners(payload.accounts.map((a) => a.owner)).find(
    (o) => o.toLowerCase().includes("yann"),
  )!;

  const states = await prisma.portfolioAccountState.findMany({
    where: { owner: { contains: "Yann", mode: "insensitive" } },
    select: { accountKey: true, accountType: true },
    orderBy: { accountKey: "asc" },
  });

  let sum = 0;
  for (const s of states) {
    const r = computePeriodResult(
      payload,
      {
        ...defaultPerformanceFilters(payload),
        preset: "custom",
        includedAccountKeys: [s.accountKey],
        excludedAccountKeys: [],
      },
      "ytd",
    );
    const g = r.gainCad ?? 0;
    sum += g;
    console.log(
      `${s.accountKey} ${(s.accountType ?? "?").padEnd(14)} $=${Math.round(g).toLocaleString("fr-CA")}`,
    );
  }

  const owner = computePeriodResult(
    payload,
    { ...defaultPerformanceFilters(payload), owner: yann, preset: "disnat" },
    "ytd",
  );
  console.log(`\nΣ comptes     $=${Math.round(sum).toLocaleString("fr-CA")}`);
  console.log(
    `Owner disnat  $=${Math.round(owner.gainCad ?? 0).toLocaleString("fr-CA")} (${owner.accountsIncluded} comptes)`,
  );
  console.log(`Disnat ref    $=298`);
  console.log(`bounds`, bounds);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
