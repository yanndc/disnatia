import { getPerformanceIndicatorPayload } from "../src/features/portfolio/performance-indicator-queries";
import {
  computeAllPeriodResults,
  computePeriodResult,
  defaultPerformanceFilters,
} from "../src/features/portfolio/performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";
import { DISNAT_RETURNS_BENCHMARK } from "../src/features/portfolio/fixtures/disnat-returns-benchmark.fixture";

function ownerRef(owner: string) {
  const lower = owner.toLowerCase();
  if (lower.includes("yann")) return DISNAT_RETURNS_BENCHMARK.yann;
  if (lower.includes("valerie") || lower.includes("degrandpre")) {
    return DISNAT_RETURNS_BENCHMARK.valerie;
  }
  return null;
}

async function main() {
const payload = await getPerformanceIndicatorPayload();
const owners = uniquePortfolioOwners(payload.accounts.map((a) => a.owner));
const periods = ["month", "month3", "year", "year3", "ytd", "all"] as const;

console.log("=== asOfNow:", payload.asOfNow, "===");
console.log("Comptes:", payload.accounts.length, "| Disnat:", payload.accounts.filter((a) => !a.isExternal).length);
console.log("\n--- Comptes ---");
for (const a of payload.accounts) {
  console.log(
    `  ${a.accountKey} | ${a.owner} | ${a.accountNumber ?? "-"} | ext=${a.isExternal}`,
  );
}

for (const [scopeLabel, preset] of [
  ["titulaire (all)", "all"],
  ["titulaire (disnat)", "disnat"],
] as const) {
  console.log(`\n=== % par ${scopeLabel} vs capture Disnat ===`);
  for (const owner of owners) {
    const ref = ownerRef(owner);
    if (!ref) continue;
    const filters = { ...defaultPerformanceFilters(payload), owner, preset };
    console.log(`\n${owner} (${ref.accountNumber}):`);
    for (const p of periods) {
      const r = computePeriodResult(payload, filters, p);
      const refPct = ref[p];
      const delta =
        r.gainPct != null && refPct != null ? (r.gainPct - refPct).toFixed(2) : "—";
      console.log(
        `  ${p.padEnd(8)} disnatia=${r.gainPct?.toFixed(2) ?? "—"}%  disnat=${refPct ?? "—"}%  Δ=${delta}  $=${Math.round(r.gainCad ?? 0)}`,
      );
    }
  }
}

// Groupe client Disnat (préfixe 5KFZE / 5L3AP sur accountKey)
for (const [prefix, ref] of [
  [DISNAT_RETURNS_BENCHMARK.yann.accountNumber, DISNAT_RETURNS_BENCHMARK.yann],
  [DISNAT_RETURNS_BENCHMARK.valerie.accountNumber, DISNAT_RETURNS_BENCHMARK.valerie],
] as const) {
  const keys = payload.accounts
    .filter((a) => !a.isExternal && a.accountKey.startsWith(prefix))
    .map((a) => a.accountKey);
  const filters = {
    ...defaultPerformanceFilters(payload),
    preset: "custom" as const,
    includedAccountKeys: keys,
    excludedAccountKeys: [],
  };
  console.log(`\n=== Groupe ${prefix} (${keys.length} comptes) ===`);
  for (const p of periods) {
    const r = computePeriodResult(payload, filters, p);
    const refPct = ref[p];
    const delta =
      r.gainPct != null && refPct != null ? (r.gainPct - refPct).toFixed(2) : "—";
    console.log(
      `  ${p.padEnd(8)} disnatia=${r.gainPct?.toFixed(2) ?? "—"}%  disnat=${refPct ?? "—"}%  Δ=${delta}  $=${Math.round(r.gainCad ?? 0)}`,
    );
  }
}

for (const [label, prefix] of [
  ["Valérie", "5L3AP"],
  ["Yann", "5KFZE"],
] as const) {
console.log(`\n=== Détail comptes ${label} (${prefix}*) ===`);
for (const a of payload.accounts.filter((x) => x.accountKey.startsWith(prefix))) {
  const filters = {
    ...defaultPerformanceFilters(payload),
    preset: "custom" as const,
    includedAccountKeys: [a.accountKey],
    excludedAccountKeys: [],
  };
  const month = computePeriodResult(payload, filters, "month");
  const year = computePeriodResult(payload, filters, "year");
  const all = computePeriodResult(payload, filters, "all");
  console.log(
    `  ${a.accountKey} | 1m=${month.gainPct?.toFixed(1) ?? "—"}% | 1a=${year.gainPct?.toFixed(1) ?? "—"}% | total=${all.gainPct?.toFixed(1) ?? "—"}% | note=${year.note ?? "-"}`,
  );
}
}

for (const [label, preset] of [
  ["Tout (all)", "all"],
  ["Disnat seul", "disnat"],
] as const) {
  console.log(`\n=== Agrégat ${label} ===`);
  const filters = { ...defaultPerformanceFilters(payload), preset };
  const results = computeAllPeriodResults(payload, filters);
  for (const r of results) {
    console.log(
      `  ${r.periodId.padEnd(10)} $=${Math.round(r.gainCad ?? 0).toLocaleString("fr-CA")}  ${r.gainPct?.toFixed(1) ?? "—"}%  method=${r.method}`,
    );
  }
}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
