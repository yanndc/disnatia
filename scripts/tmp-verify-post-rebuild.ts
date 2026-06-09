/**
 * Vérif post-rebuild : Σ session_gains vs Δ valeur (flux externes).
 */
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  aggregateSessionGainsForAccounts,
  computePeriodResult,
  computeTitresPeriodGain,
  defaultPerformanceFilters,
  resolvePeriodBounds,
} from "@/features/portfolio/performance-indicator-logic";

const fmt = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("fr-CA", { maximumFractionDigits: 0 });

async function main() {
  const now = new Date();
  const payload = await getPerformanceIndicatorPayload();
  const keys = payload.accounts.filter((a) => !a.isExternal).map((a) => a.accountKey);

  console.log("=== SANTÉ ===");
  console.log(payload.sessionDataHealth);
  console.log("");

  for (const period of ["day", "month", "month3", "year", "ytd"] as const) {
    const bounds = resolvePeriodBounds(period, now, 2026, null);
    const sessions = aggregateSessionGainsForAccounts(payload, keys).filter(
      (g) =>
        bounds.start != null && g.date >= bounds.start && g.date <= bounds.end,
    );
    const sumSessions = sessions.reduce((s, g) => s + g.gainCad, 0);
    const ui = computePeriodResult(payload, defaultPerformanceFilters(payload), period);
    const vd =
      bounds.start != null
        ? computeTitresPeriodGain(keys, payload, bounds)
        : null;

    console.log(`--- ${period} (${bounds.start} → ${bounds.end}) ---`);
    console.log("UI $", fmt(ui.gainCad), "| UI %", ui.gainPct?.toFixed(2) ?? "—");
    console.log("Σ séances $", fmt(sumSessions), "| jours", sessions.length);
    if (vd?.usable) {
      console.log("Δ valeur $", fmt(vd.gainCad), "| %", vd.gainPct?.toFixed(2));
      console.log("Écart Σ/Δ", fmt(sumSessions - (vd.gainCad ?? 0)));
    }
    console.log("method", ui.method, "| incomplete", ui.incomplete, "| note", ui.note ?? "—");
    console.log("");
  }
}

main().catch(console.error);
