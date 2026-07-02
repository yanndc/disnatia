import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResultWithSnapshots,
  defaultPerformanceFilters,
  resolveActiveAccountKeys,
} from "@/features/portfolio/performance-indicator-logic";

function fmt(n: number): string {
  return n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });
}

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const scopes = payload.portfolioScopes ?? [];
  const household =
    scopes.find((s) => s.portfolioKey === "household:all") ??
    scopes.find((s) => s.kind === "HOUSEHOLD");

  if (!household) {
    console.log("Aucun portefeuille Famille trouvé.");
    return;
  }

  const base = defaultPerformanceFilters(payload);

  const allKeys = resolveActiveAccountKeys(
    payload.accounts,
    base.preset,
    base.includedAccountKeys,
    base.excludedAccountKeys,
    base.owner,
    base.portfolioKey ?? null,
    scopes,
  );

  const householdFilters = { ...base, portfolioKey: household.portfolioKey };
  const householdKeys = resolveActiveAccountKeys(
    payload.accounts,
    householdFilters.preset,
    householdFilters.includedAccountKeys,
    householdFilters.excludedAccountKeys,
    householdFilters.owner,
    householdFilters.portfolioKey ?? null,
    scopes,
  );

  const allSet = new Set(allKeys);
  const householdSet = new Set(householdKeys);

  const missingInHousehold = allKeys.filter((k) => !householdSet.has(k));
  const extraInHousehold = householdKeys.filter((k) => !allSet.has(k));

  const getAccountMeta = (key: string) => payload.accounts.find((a) => a.accountKey === key);
  const sumCad = (keys: string[]) =>
    keys.reduce((sum, key) => sum + (payload.currentByAccount[key]?.totalCad ?? 0), 0);

  const allDay = computePeriodResultWithSnapshots(payload, base, "day");
  const famDay = computePeriodResultWithSnapshots(payload, householdFilters, "day");
  const allYtd = computePeriodResultWithSnapshots(payload, base, "ytd");
  const famYtd = computePeriodResultWithSnapshots(payload, householdFilters, "ytd");

  console.log(`Scope famille: ${household.label} (${household.portfolioKey})`);
  console.log(`Comptes ALL: ${allKeys.length} | Comptes FAMILLE: ${householdKeys.length}`);
  console.log(`Valeur ALL: ${fmt(sumCad(allKeys))} CAD | Valeur FAMILLE: ${fmt(sumCad(householdKeys))} CAD`);
  console.log(`Ecart valeur (ALL - FAMILLE): ${fmt(sumCad(allKeys) - sumCad(householdKeys))} CAD`);
  console.log(`Day ALL/FAM: ${fmt(allDay.gainCad ?? 0)} / ${fmt(famDay.gainCad ?? 0)} CAD`);
  console.log(`YTD ALL/FAM: ${fmt(allYtd.gainCad ?? 0)} / ${fmt(famYtd.gainCad ?? 0)} CAD`);

  console.log("\n--- Comptes manquants dans FAMILLE ---");
  if (missingInHousehold.length === 0) {
    console.log("Aucun");
  } else {
    for (const key of missingInHousehold) {
      const a = getAccountMeta(key);
      console.log(
        `${key} | ${a?.label ?? "?"} | owner=${a?.owner ?? "null"} | external=${a?.isExternal ? "oui" : "non"} | totalCad=${fmt(payload.currentByAccount[key]?.totalCad ?? 0)}`,
      );
    }
  }

  console.log("\n--- Comptes en plus dans FAMILLE ---");
  if (extraInHousehold.length === 0) {
    console.log("Aucun");
  } else {
    for (const key of extraInHousehold) {
      const a = getAccountMeta(key);
      console.log(
        `${key} | ${a?.label ?? "?"} | owner=${a?.owner ?? "null"} | external=${a?.isExternal ? "oui" : "non"} | totalCad=${fmt(payload.currentByAccount[key]?.totalCad ?? 0)}`,
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
