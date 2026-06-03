/**
 * Compare gain 1 mois : Δ valeur vs Σ séances vs somme jours Préc.
 */
import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computeTitresPeriodGain,
  resolvePeriodBounds,
  aggregateSessionGainsForAccounts,
} from "@/features/portfolio/performance-indicator-logic";

const fmt = (n: number) =>
  n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

async function main() {
  const now = new Date();
  const payload = await getPerformanceIndicatorPayload();
  const keys = payload.accounts.filter((a) => !a.isExternal).map((a) => a.accountKey);
  const bounds = resolvePeriodBounds("month", now, 2026, null);

  const vd = computeTitresPeriodGain(keys, payload, bounds);
  const sessions = aggregateSessionGainsForAccounts(payload, keys).filter(
    (g) => g.date >= bounds.start! && g.date <= bounds.end,
  );
  const sumSessions = sessions.reduce((s, g) => s + g.gainCad, 0);

  console.log("Période:", bounds.start, "→", bounds.end, "| baseline", bounds.baselineLookup);
  console.log("Δ valeur (titres):", fmt(vd.gainCad ?? 0), "| %", vd.gainPct?.toFixed(2));
  console.log("Σ session_gains:", fmt(sumSessions), "| jours:", sessions.length);
  console.log("Ratio Δ/Σ séances:", ((vd.gainCad ?? 0) / (sumSessions || 1)).toFixed(2));

  // Cotisations / transferts sur la période
  let flows = 0;
  for (const f of payload.cashFlows) {
    if (!keys.includes(f.accountKey)) continue;
    if (f.tradeDate < bounds.start! || f.tradeDate > bounds.end) continue;
    flows += f.amountCad;
  }
  console.log("Flux nets payload.cashFlows:", fmt(flows), "| nb:", payload.cashFlows.filter(
    (f) => keys.includes(f.accountKey) && f.tradeDate >= bounds.start! && f.tradeDate <= bounds.end,
  ).length);

  // Achats nets (BUY) approximatifs
  const buys = await prisma.portfolioTransactionLine.findMany({
    where: {
      accountKey: { in: keys },
      tradeDate: {
        gte: new Date(bounds.start! + "T12:00:00"),
        lte: new Date(bounds.end + "T12:00:00"),
      },
      txCategory: "BUY",
    },
    select: { amount: true, currency: true, accountKey: true, tradeDate: true },
  });
  let buyCad = 0;
  for (const b of buys) {
    const amt = b.amount ?? 0;
    buyCad += b.currency === "USD" && payload.usdToCad ? amt * payload.usdToCad : amt;
  }
  console.log("Σ BUY (brut, non exclu du gain):", fmt(buyCad), "| lignes:", buys.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
