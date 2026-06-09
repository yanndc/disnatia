/**
 * Audit rigueur : couverture session_gains vs recomputation attendue.
 */
import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  aggregateSessionGainsForAccounts,
  computeTitresPeriodGain,
  resolvePeriodBounds,
} from "@/features/portfolio/performance-indicator-logic";
import { recomputeAndPersistSessionGains } from "@/features/portfolio/performance-session-gains";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";

const fmt = (n: number) => n.toLocaleString("fr-CA", { maximumFractionDigits: 0 });

async function main() {
  const now = new Date();
  const payload = await getPerformanceIndicatorPayload();
  const keys = payload.accounts.filter((a) => !a.isExternal).map((a) => a.accountKey);
  const bounds = resolvePeriodBounds("month", now, 2026, null);

  const persisted = aggregateSessionGainsForAccounts(payload, keys).filter(
    (g) => g.date >= bounds.start! && g.date <= bounds.end,
  );
  const sumPersisted = persisted.reduce((s, g) => s + g.gainCad, 0);

  const vd = computeTitresPeriodGain(keys, payload, bounds);

  // Recompute in-memory for same window (dry run via function)
  const fx = await getUsdCadRateNear(new Date(bounds.end + "T12:00:00"));
  const { rowsWritten } = await recomputeAndPersistSessionGains(
    keys,
    bounds.start!,
    bounds.end,
    fx,
  );

  const payload2 = await getPerformanceIndicatorPayload();
  const recomputed = aggregateSessionGainsForAccounts(payload2, keys).filter(
    (g) => g.date >= bounds.start! && g.date <= bounds.end,
  );
  const sumRecomputed = recomputed.reduce((s, g) => s + g.gainCad, 0);

  // Expected trading days in range
  const { count: holdingDays } = await prisma.portfolioDailyAccountSessionGain.groupBy({
    by: ["sessionDate"],
    where: {
      accountKey: { in: keys },
      sessionDate: {
        gte: new Date(bounds.start! + "T12:00:00"),
        lte: new Date(bounds.end + "T12:00:00"),
      },
    },
    _count: true,
  });

  console.log("=== AUDIT 1 MOIS ===");
  console.log("Période:", bounds.start, "→", bounds.end);
  console.log("Comptes:", keys.length);
  console.log("");
  console.log("Σ session_gains (persisté avant):", fmt(sumPersisted), "| jours:", persisted.length);
  console.log("Σ session_gains (après recompute):", fmt(sumRecomputed), "| jours:", recomputed.length);
  console.log("Rows written:", rowsWritten);
  console.log("Δ valeur titres (fallback actuel):", fmt(vd.gainCad ?? 0), "| %", vd.gainPct?.toFixed(2));
  console.log("");
  console.log("Écart recompute vs Δ valeur:", fmt(sumRecomputed - (vd.gainCad ?? 0)));
  console.log("Session data health:", payload.sessionDataHealth);
  console.log("");
  console.log("Dates session_gains distinctes:", holdingDays.length);

  // Per-day gap last 10 days
  console.log("\n=== 10 derniers jours (persisté vs attendu via prior) ===");
  for (const g of recomputed.slice(-10)) {
    const pct = g.priorCad > 0 ? ((g.gainCad / g.priorCad) * 100).toFixed(2) : "—";
    console.log(g.date, fmt(g.gainCad), "| prior", fmt(g.priorCad), "| r", pct, "%");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
