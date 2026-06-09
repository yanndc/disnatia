import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResult,
  computeTitresPeriodGain,
  defaultPerformanceFilters,
  resolvePeriodBounds,
} from "@/features/portfolio/performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";

const fmtPct = (n: number | null) => (n == null ? "—" : `${n.toFixed(2)} %`);
const fmt = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("fr-CA", { maximumFractionDigits: 0 });

async function main() {
  const now = new Date();
  const payload = await getPerformanceIndicatorPayload();
  const periods = ["month", "month3", "year", "ytd", "all"] as const;

  console.log("Comparaison session-chain (UI) vs Δ valeur titres (flux ajustés)\n");

  for (const owner of uniquePortfolioOwners(payload.accounts.map((a) => a.owner))) {
    const filters = { ...defaultPerformanceFilters(payload), owner };
    console.log(`=== ${owner} ===`);
    for (const p of periods) {
      const bounds = resolvePeriodBounds(p, now, 2026, null);
      const keys = payload.accounts
        .filter((a) => !a.isExternal && a.owner === owner)
        .map((a) => a.accountKey);
      const chain = computePeriodResult(payload, filters, p);
      const delta = computeTitresPeriodGain(keys, payload, bounds);
      console.log(
        p.padEnd(7),
        "chain",
        fmtPct(chain.gainPct),
        fmt(chain.gainCad),
        "| Δval",
        fmtPct(delta.gainPct),
        fmt(delta.gainCad),
        "| start",
        bounds.start,
        "base",
        bounds.baselineLookup,
      );
    }
    console.log();
  }
}

main().catch(console.error);
