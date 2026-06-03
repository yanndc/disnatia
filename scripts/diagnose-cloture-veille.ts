/**
 * Vérifie que « début » = clôture légale veille (BD) et où ça diverge (Yahoo, qty, cours).
 */
import { prisma } from "@/lib/db/prisma";
import { loadHoldingsForDashboard } from "@/features/portfolio/holdings-display-query";
import { indexQuotesByTickerCurrency } from "@/features/portfolio/live-enrichment";
import { priorSessionCloseByPair } from "@/features/portfolio/daily-close-prices";
import { priorSessionDateIso, isoDateInToronto } from "@/lib/market/equity-session";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";
import { normalizeCurrency } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

function toCad(v: number, cur: string, fx: number) {
  return normalizeCurrency(cur) === "USD" && fx ? v * fx : v;
}

async function main() {
  const now = new Date();
  const priorDay = priorSessionDateIso(now);
  const today = isoDateInToronto(now);
  console.log("Aujourd'hui (Toronto):", today);
  console.log("Clôture de référence (veille légale):", priorDay, "\n");

  const holdings = await loadHoldingsForDashboard();
  const quotes = await prisma.portfolioLiveQuote.findMany();
  const quoteMap = indexQuotesByTickerCurrency(quotes);
  const fx = (await getUsdCadRateNear(now))?.usdToCad ?? 1.38;

  const pairs = [
    ...new Map(
      holdings.map((h) => [
        `${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`,
        { ticker: h.ticker.toUpperCase(), currency: normalizeCurrency(h.currency) },
      ]),
    ).values(),
  ];
  const priorMap = await priorSessionCloseByPair(pairs, now);

  let debutBd = 0;
  let debutYahoo = 0;
  let finLive = 0;
  const rows: {
    ticker: string;
    cur: string;
    qty: number;
    closeBd: number | null;
    closeYahoo: number | null;
    live: number | null;
    impactCad: number;
  }[] = [];

  for (const h of holdings) {
    if (h.quantity <= 0) continue;
    const pk = `${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`;
    const q = quoteMap.get(pk);
    const closeBd = priorMap.get(pk) ?? null;
    const closeYahoo = q?.previousClose ?? null;
    const live = q?.price ?? null;
    if (closeBd == null && closeYahoo == null) continue;
    const ref = closeBd ?? closeYahoo!;
    const delta = live != null ? live - ref : 0;
    const impact = toCad(delta * h.quantity, h.currency, fx);
    debutBd += closeBd != null ? toCad(closeBd * h.quantity, h.currency, fx) : 0;
    if (closeYahoo != null) {
      debutYahoo += toCad(closeYahoo * h.quantity, h.currency, fx);
    }
    if (live != null) finLive += toCad(live * h.quantity, h.currency, fx);
    if (
      closeBd != null &&
      closeYahoo != null &&
      Math.abs(closeBd - closeYahoo) > 0.02
    ) {
      rows.push({
        ticker: h.ticker,
        cur: h.currency,
        qty: h.quantity,
        closeBd,
        closeYahoo,
        live,
        impactCad: toCad((closeYahoo - closeBd) * h.quantity, h.currency, fx),
      });
    }
  }

  rows.sort((a, b) => Math.abs(b.impactCad) - Math.abs(a.impactCad));

  console.log("=== Totaux portefeuille (titres, CAD) ===");
  console.log("Début si clôture BD (veille):  ", fmt(debutBd));
  console.log("Début si previousClose Yahoo:", fmt(debutYahoo));
  console.log("Fin (cours live):            ", fmt(finLive));
  console.log("Δ (BD):                      ", fmt(finLive - debutBd));
  console.log("Δ (Yahoo prev):              ", fmt(finLive - debutYahoo));

  console.log("\nTitres où clôture BD ≠ Yahoo previousClose (impact $ sur début):");
  for (const r of rows.slice(0, 12)) {
    console.log(
      `  ${r.ticker} (${r.cur}) qty=${r.qty}`,
      `BD@${priorDay}=${r.closeBd?.toFixed(2)}`,
      `Yahoo=${r.closeYahoo?.toFixed(2)}`,
      `→ écart début ~${fmt(r.impactCad)}`,
    );
  }
  if (rows.length === 0) {
    console.log("  (aucun — BD et Yahoo alignés sur les lignes)");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
