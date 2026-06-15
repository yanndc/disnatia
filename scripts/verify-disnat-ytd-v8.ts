import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResult,
  defaultPerformanceFilters,
} from "@/features/portfolio/performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";
import { DISNAT_DOLLARS_BENCHMARK } from "@/features/portfolio/fixtures/disnat-dollars-benchmark.fixture";

const AS_OF = "2026-06-15T14:07:00";

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;

  console.log("=== YTD $ vs Disnat 14:07 (v8) ===");
  for (const [key, ref] of Object.entries(
    DISNAT_DOLLARS_BENCHMARK.yann.byAccountKey,
  )) {
    const r = computePeriodResult(
      payload,
      {
        ...defaultPerformanceFilters(payload),
        preset: "custom",
        includedAccountKeys: [key],
        excludedAccountKeys: [],
      },
      "ytd",
    );
    console.log(
      `${key} app=${Math.round(r.gainCad ?? 0)} disnat=${ref.ytd} Δ=${Math.round((r.gainCad ?? 0) - (ref.ytd ?? 0))}`,
    );
  }
  for (const [key, ref] of Object.entries(
    DISNAT_DOLLARS_BENCHMARK.valerie.byAccountKey,
  )) {
    const r = computePeriodResult(
      payload,
      {
        ...defaultPerformanceFilters(payload),
        preset: "custom",
        includedAccountKeys: [key],
        excludedAccountKeys: [],
      },
      "ytd",
    );
    console.log(
      `${key} app=${Math.round(r.gainCad ?? 0)} disnat=${ref.ytd} Δ=${Math.round((r.gainCad ?? 0) - (ref.ytd ?? 0))}`,
    );
  }
  for (const owner of uniquePortfolioOwners(payload.accounts.map((a) => a.owner))) {
    const ok = owner.toLowerCase().includes("yann")
      ? "yann"
      : owner.toLowerCase().includes("valerie")
        ? "valerie"
        : null;
    if (!ok) continue;
    const r = computePeriodResult(
      payload,
      { ...defaultPerformanceFilters(payload), owner, preset: "disnat" },
      "ytd",
    );
    const ref = DISNAT_DOLLARS_BENCHMARK.owners[ok].ytd;
    console.log(
      `OWNER ${ok} app=${Math.round(r.gainCad ?? 0)} disnat=${ref} pct=${r.gainPct?.toFixed(2)}%`,
    );
  }
}

main().catch(console.error);
