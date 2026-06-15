import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computeAllPeriodResults,
  defaultPerformanceFilters,
  resolvePeriodBounds,
  resolveActiveAccountKeys,
} from "@/features/portfolio/performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";
import { performanceScopeKey } from "@/features/portfolio/performance-snapshot-scope";

const AS_OF = "2026-06-15T14:40:00";

function parseIsoDate(s: string): Date {
  if (s.includes("T")) return new Date(s);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;
  payload.sessionDataHealth = { ok: true, message: null, persistedDays: 1103, firstDate: "2022-03-23", lastDate: "2026-06-12" };
  const now = parseIsoDate(AS_OF);
  now.setHours(15, 0, 0, 0);

  console.log("sessionDataHealth", payload.sessionDataHealth);
  console.log("snapshots v", payload.performanceSnapshots?.calcVersion);

  for (const owner of uniquePortfolioOwners(payload.accounts.map((a) => a.owner))) {
    if (!owner.toLowerCase().includes("valerie")) continue;

    const filters = {
      ...defaultPerformanceFilters(payload),
      owner,
      preset: "disnat" as const,
    };
    const keys = resolveActiveAccountKeys(
      payload.accounts,
      filters.preset,
      filters.includedAccountKeys,
      filters.excludedAccountKeys,
      filters.owner,
    );

    console.log("\n===", owner, "accounts", keys.length);

    for (const r of computeAllPeriodResults(payload, filters)) {
      if (!["month", "month3", "year", "ytd"].includes(r.periodId)) continue;
      console.log(r.periodId, {
        $: r.gainCad != null ? Math.round(r.gainCad) : null,
        pct: r.gainPct?.toFixed(2),
        method: r.method,
        note: r.note?.slice(0, 80),
      });
    }

    const snap = payload.performanceSnapshots?.byScopeKey[performanceScopeKey(filters)];
    if (snap) {
      console.log("--- cached snapshot $ ---");
      for (const r of snap) {
        if (["month", "month3", "year", "ytd"].includes(r.periodId)) {
          console.log(r.periodId, Math.round(r.gainCad ?? 0), r.gainPct?.toFixed(2));
        }
      }
    }
  }
}

main().catch(console.error);
