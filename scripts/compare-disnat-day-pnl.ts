import { loadHoldingsForDashboard } from "@/features/portfolio/holdings-display-query";
import { prisma } from "@/lib/db/prisma";
import {
  enrichPositionRow,
  indexQuotesByTickerCurrency,
} from "@/features/portfolio/live-enrichment";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";
import { priorSessionCloseByPair } from "@/features/portfolio/daily-close-prices";

const DISNAT = {
  yann: 1010.37,
  valerie: 360.8,
  total: 1371.17,
};

async function main() {
  const holdings = await loadHoldingsForDashboard();
  const pairSet = new Set<string>();
  const pairs: { ticker: string; currency: string }[] = [];
  for (const h of holdings) {
    const k = `${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`;
    if (pairSet.has(k)) continue;
    pairSet.add(k);
    pairs.push({ ticker: h.ticker.toUpperCase(), currency: h.currency.toUpperCase() });
  }
  const quotes = await prisma.portfolioLiveQuote.findMany({
    where: { OR: pairs.map((p) => ({ ticker: p.ticker, currency: p.currency })) },
  });
  const qmap = indexQuotesByTickerCurrency(quotes);
  const priorCloseByPair = await priorSessionCloseByPair(pairs);
  const fx = (await getUsdCadRateNear(new Date()))?.usdToCad ?? 1.3779;

  const byOwnerAll = new Map<string, number>();
  const byOwnerLive = new Map<string, number>();
  let allGain = 0;
  let liveGain = 0;

  for (const h of holdings) {
    const pairKey = `${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`;
    const quote = qmap.get(pairKey);
    const e = enrichPositionRow(
      {
        id: h.id,
        importId: h.sourceImportId,
        accountId: null,
        accountKey: h.accountKey,
        accountNumber: h.accountNumber,
        ticker: h.ticker,
        securityName: h.securityName ?? "",
        currency: h.currency,
        quantity: h.quantity,
        averageCost: h.averageCost,
        marketPrice: h.snapshotPrice,
        marketValue: h.snapshotValue,
        unrealizedGainLoss: h.unrealizedGainLoss,
        loanValue: h.loanValue,
        weightPct: null,
        sector: h.sector,
        assetType: h.assetType,
      },
      h.accountName,
      quote,
      priorCloseByPair.get(pairKey) ?? null,
    );
    if (e.displayDayGainLoss == null) continue;
    const native = e.displayDayGainLoss;
    const cad = h.currency.toUpperCase() === "USD" ? native * fx : native;
    const owner = h.accountName;
    allGain += cad;
    byOwnerAll.set(owner, (byOwnerAll.get(owner) ?? 0) + cad);
    if (e.usesLiveQuote) {
      liveGain += cad;
      byOwnerLive.set(owner, (byOwnerLive.get(owner) ?? 0) + cad);
    }
  }

  console.log("FX", fx);
  console.log("All lines gain CAD:", allGain.toFixed(2));
  console.log("Live-only gain CAD:", liveGain.toFixed(2));
  console.log("By owner (all):", Object.fromEntries(byOwnerAll));
  console.log("By owner (live):", Object.fromEntries(byOwnerLive));
  console.log("Disnat ref:", DISNAT);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
