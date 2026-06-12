import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResult,
  defaultPerformanceFilters,
} from "@/features/portfolio/performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";
import { DISNAT_RETURNS_BENCHMARK } from "@/features/portfolio/fixtures/disnat-returns-benchmark.fixture";

/** Capture Disnat juin 2026 — gains $ (convertis CAD côté Disnat). */
const DISNAT_DOLLARS_BENCHMARK = {
  yann: {
    total: { month3: 814.91, year: 169_067.19, year3: 169_882.1, ytd: 298.47 },
    byType: {
      "Comptant|CAD": { month3: 0, year: 0, year3: 0, ytd: 0 },
      "Comptant|USD": { month3: 0, year: 0, year3: 0, ytd: 0 },
      "CELI|CAD": { month3: 435, year: 28_671.76, year3: 29_106.76, ytd: -165.19 },
      "CELI|USD": { month3: 3.78, year: 1_446.66, year3: 1_450.44, ytd: 12.42 },
      "REER|CAD": { month3: 10.99, year: 14_858.47, year3: 14_869.46, ytd: -64.84 },
      "REER|USD": { month3: 111.32, year: 57_136.63, year3: 57_247.95, ytd: 118.84 },
      "CRI|CAD": { month3: 14.15, year: 0, year3: 14.15, ytd: 0 },
      "CRI|USD": { month3: 138.89, year: 31_291.4, year3: 31_430.29, ytd: 247.11 },
    },
  },
  valerie: {
    total: { month3: 129.2, year: 68_877.68, year3: 69_006.88, ytd: 397.95 },
    byType: {
      "Comptant|CAD": { month3: 0, year: 0, year3: 0, ytd: 0 },
      "Comptant|USD": { month3: 0, year: 0, year3: 0, ytd: 0 },
      "REER conjoint|CAD": { month3: 48.02, year: 58_461.04, year3: 58_509.06, ytd: 315.52 },
      "REER conjoint|USD": { month3: 58.12, year: 7_457.5, year3: 7_515.62, ytd: 59.01 },
    },
  },
} as const;

const PERIODS = ["month3", "year", "year3", "ytd"] as const;

function ownerKey(owner: string): "yann" | "valerie" | null {
  const l = owner.toLowerCase();
  if (l.includes("yann")) return "yann";
  if (l.includes("valerie") || l.includes("degrandpre")) return "valerie";
  return null;
}

function typeKey(accountType: string | null, currency: string): string {
  const t = accountType ?? "?";
  const cur = currency.toUpperCase().includes("USD") ? "USD" : "CAD";
  return `${t}|${cur}`;
}

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const states = await prisma.portfolioAccountState.findMany({
    where: {
      OR: [
        { accountKey: { startsWith: "5KFZE" } },
        { accountKey: { startsWith: "5L3AP" } },
      ],
    },
    select: {
      accountKey: true,
      owner: true,
      accountType: true,
      accountName: true,
      currency: true,
    },
    orderBy: { accountKey: "asc" },
  });

  console.log("=== Comptes Disnatia ===");
  for (const s of states) {
    console.log(`  ${s.accountKey} | ${s.accountType ?? "?"} | ${s.accountName}`);
  }

  const owners = uniquePortfolioOwners(payload.accounts.map((a) => a.owner));

  for (const owner of owners) {
    const ok = ownerKey(owner);
    if (!ok) continue;
    const refPct = DISNAT_RETURNS_BENCHMARK[ok];
    const ref$ = DISNAT_DOLLARS_BENCHMARK[ok];

    console.log(`\n=== ${owner} (${refPct.accountNumber}) ===`);

    const ownerFilters = { ...defaultPerformanceFilters(payload), owner, preset: "disnat" as const };
    for (const p of PERIODS) {
      const r = computePeriodResult(payload, ownerFilters, p);
      const refVal = ref$.total[p];
      const delta = r.gainCad != null ? Math.round(r.gainCad - refVal) : null;
      const refP = refPct[p];
      console.log(
        `  ${p.padEnd(7)} $ disnatia=${Math.round(r.gainCad ?? 0).toLocaleString("fr-CA")} disnat=${Math.round(refVal).toLocaleString("fr-CA")} Δ=${delta?.toLocaleString("fr-CA") ?? "—"} | % disnatia=${r.gainPct?.toFixed(2) ?? "—"} disnat=${refP ?? "—"}`,
      );
    }

    const ownerAccounts = states.filter((s) =>
      owner.toLowerCase().includes(ok === "yann" ? "yann" : "valerie"),
    );

    console.log("\n  Par type de compte ($):");
    const byType = new Map<string, string[]>();
    for (const s of ownerAccounts) {
      const k = typeKey(s.accountType, s.currency);
      const keys = byType.get(k) ?? [];
      keys.push(s.accountKey);
      byType.set(k, keys);
    }

    for (const [tk, keys] of [...byType.entries()].sort()) {
      const refType = ref$.byType[tk as keyof typeof ref$.byType];
      if (!refType) {
        console.log(`  ${tk}: (pas dans capture Disnat) keys=${keys.join(",")}`);
        continue;
      }
      const filters = {
        ...defaultPerformanceFilters(payload),
        preset: "custom" as const,
        includedAccountKeys: keys,
        excludedAccountKeys: [],
      };
      const parts: string[] = [];
      for (const p of PERIODS) {
        const r = computePeriodResult(payload, filters, p);
        const refVal = refType[p];
        const delta = r.gainCad != null ? Math.round(r.gainCad - refVal) : null;
        parts.push(`${p} Δ${delta?.toLocaleString("fr-CA") ?? "—"}`);
      }
      console.log(`  ${tk.padEnd(18)} disnat YTD=${refType.ytd} | ${parts.join(" | ")}`);
    }

    console.log("\n  Par compte individuel (YTD $):");
    for (const s of ownerAccounts) {
      const filters = {
        ...defaultPerformanceFilters(payload),
        preset: "custom" as const,
        includedAccountKeys: [s.accountKey],
        excludedAccountKeys: [],
      };
      const ytd = computePeriodResult(payload, filters, "ytd");
      console.log(
        `    ${s.accountKey} (${s.accountType}) YTD=${Math.round(ytd.gainCad ?? 0)} $ ${ytd.gainPct?.toFixed(1) ?? "—"}%`,
      );
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
