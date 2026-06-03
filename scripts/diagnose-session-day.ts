/**
 * Diagnostic Séance (jour) : Σ dayGainCad vs détail par compte / titre.
 */
import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResult,
  defaultPerformanceFilters,
} from "@/features/portfolio/performance-indicator-logic";
const fmt = (n: number) =>
  n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const filters = defaultPerformanceFilters(payload);
  const keys = payload.accounts.filter((a) => !a.isExternal).map((a) => a.accountKey);
  const day = computePeriodResult(payload, filters, "day");

  console.log("=== Séance (computePeriodResult day) ===");
  console.log("gainCad:", fmt(day.gainCad ?? 0), "| %", day.gainPct?.toFixed(2) ?? "—");
  console.log("method:", day.method, "| incomplete:", day.incomplete);
  console.log("note:", day.note ?? "—");

  let sumAccount = 0;
  console.log("\nPar compte (payload.currentByAccount.dayGainCad):");
  const rows: { key: string; gain: number; prior: number; pos: number }[] = [];
  for (const k of keys) {
    const c = payload.currentByAccount[k];
    if (!c) continue;
    const g = c.dayGainCad ?? 0;
    if (c.dayGainCad != null) sumAccount += g;
    rows.push({
      key: k,
      gain: g,
      prior: c.dayPriorCad ?? 0,
      pos: c.positionsCad,
    });
  }
  rows.sort((a, b) => a.gain - b.gain);
  for (const r of rows) {
    if (r.pos <= 0 && r.gain === 0) continue;
    console.log(
      `  ${r.key}`,
      "| jour",
      fmt(r.gain),
      "| prior",
      fmt(r.prior),
      "| titres",
      fmt(r.pos),
    );
  }
  console.log("Σ comptes:", fmt(sumAccount));
  console.log("USD→CAD:", payload.usdToCad?.toFixed(4) ?? "—");
  console.log("Écart vs Disnat -1163:", fmt((day.gainCad ?? 0) - -1163));

  let sumEnriched = 0;
  const eh = payload.enrichedHoldings ?? [];
  for (const h of eh) {
    sumEnriched += h.displayDayGainLoss ?? 0;
  }
  console.log("Σ enrichedHoldings (native mix):", fmt(sumEnriched), "| lignes:", eh.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
