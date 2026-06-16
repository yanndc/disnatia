import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import { computePeriodResult, defaultPerformanceFilters } from "@/features/portfolio/performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";
import { DISNAT_RETURNS_BENCHMARK } from "@/features/portfolio/fixtures/disnat-returns-benchmark.fixture";

const AS_OF = "2026-06-15T14:07:00";

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;

  for (const owner of uniquePortfolioOwners(payload.accounts.map((a) => a.owner))) {
    const lower = owner.toLowerCase();
    const ref = lower.includes("yann")
      ? DISNAT_RETURNS_BENCHMARK.yann
      : lower.includes("valerie")
        ? DISNAT_RETURNS_BENCHMARK.valerie
        : null;
    if (!ref) continue;

    console.log(`\n=== ${owner.split(" ")[0]} ===`);
    for (const p of ["month", "month3", "year", "ytd"] as const) {
      const r = computePeriodResult(
        payload,
        { ...defaultPerformanceFilters(payload), owner, preset: "disnat" },
        p,
      );
      const delta = r.gainPct != null ? (r.gainPct - ref[p]).toFixed(2) : "—";
      console.log(
        p,
        `$${Math.round(r.gainCad ?? 0)}`,
        `${r.gainPct?.toFixed(2)}%`,
        `disnat ${ref[p]}%`,
        `Δ${delta}`,
      );
    }
  }

  for (const key of ["5L3APB3|USD", "5L3APA5|CAD"]) {
    const sg = payload.sessionGainsByAccount?.[key] ?? [];
    console.log(`\n${key} sessions=${sg.length} pos=${payload.currentByAccount[key]?.positionsCad ?? 0}`);
    if (sg.length) {
      const recent = sg.filter((g) => g.date >= "2026-05-15");
      console.log("  recent", recent.slice(0, 3).map((g) => `${g.date} gain=${Math.round(g.gainCad)} prior=${Math.round(g.priorCad)}`));
    }
  }
}

main().catch(console.error);
