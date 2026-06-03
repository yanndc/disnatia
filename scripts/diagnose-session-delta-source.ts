/**
 * Compare P&L séance : changeAmount Yahoo vs (live − clôture veille).
 */
import { prisma } from "@/lib/db/prisma";
import { loadHoldingsForDashboard } from "@/features/portfolio/holdings-display-query";
import { indexQuotesByTickerCurrency } from "@/features/portfolio/live-enrichment";
import { priorSessionCloseByPair } from "@/features/portfolio/daily-close-prices";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import { normalizeCurrency } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

function toCad(v: number, cur: string, fx: number | null) {
  return normalizeCurrency(cur) === "USD" && fx ? v * fx : v;
}

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const fx = payload.usdToCad;
  const holdings = await loadHoldingsForDashboard();
  const quotes = await prisma.portfolioLiveQuote.findMany();
  const quoteMap = indexQuotesByTickerCurrency(quotes);
  const pairs = [
    ...new Map(
      holdings.map((h) => [
        `${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`,
        { ticker: h.ticker.toUpperCase(), currency: normalizeCurrency(h.currency) },
      ]),
    ).values(),
  ];
  const priorMap = await priorSessionCloseByPair(pairs);

  let sumApp = 0;
  let sumChangeAmt = 0;
  let sumDerived = 0;
  const divergent: {
    ticker: string;
    acct: string;
    qty: number;
    ch: number;
    der: number;
    used: number;
    diffCad: number;
  }[] = [];

  for (const h of holdings) {
    if (h.quantity <= 0) continue;
    const key = `${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`;
    const q = quoteMap.get(key);
    const prior = priorMap.get(key) ?? q?.previousClose ?? null;
    const live = q?.price ?? null;
    const ch = q?.changeAmount ?? null;
    if (live == null || prior == null) continue;
    const derived = live - prior;
    const tolerance = Math.max(0.02, Math.abs(derived) * 0.25);
    const useDerived = ch != null && Math.abs(ch - derived) > tolerance;
    const delta = useDerived ? derived : (ch ?? derived);
    const lineCad = toCad(delta * h.quantity, h.currency, fx);
    sumApp += lineCad;
    if (ch != null) sumChangeAmt += toCad(ch * h.quantity, h.currency, fx);
    sumDerived += toCad(derived * h.quantity, h.currency, fx);
    if (ch != null && Math.abs(ch - derived) > 0.05) {
      divergent.push({
        ticker: h.ticker,
        acct: h.accountKey,
        qty: h.quantity,
        ch,
        der: derived,
        used: delta,
        diffCad: toCad((delta - ch) * h.quantity, h.currency, fx),
      });
    }
  }

  divergent.sort((a, b) => Math.abs(b.diffCad) - Math.abs(a.diffCad));
  console.log("Σ séance (logique app):", fmt(sumApp));
  console.log("Σ si changeAmount partout:", fmt(sumChangeAmt));
  console.log("Σ si (live−prior) partout:", fmt(sumDerived));
  console.log("Disnatia affiché:", fmt(-1359.47), "| Disnat ref:", fmt(-1163));
  console.log("\nLignes où Δ/action ≠ changeAmount (top 8):");
  for (const r of divergent.slice(0, 8)) {
    console.log(
      `  ${r.ticker} ${r.acct} qty=${r.qty}`,
      `ch=${r.ch.toFixed(2)} der=${r.der.toFixed(2)} → écart CAD ${fmt(r.diffCad)}`,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
