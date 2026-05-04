import { getLatestDashboardImport } from "@/features/portfolio/queries";
import { prisma } from "@/lib/db/prisma";
import { disnatTickerToYahooSymbol } from "@/lib/market/disnat-ticker";
import { fetchYahooQuotesBySymbol } from "@/lib/market/yahoo-quote";

export type RefreshLiveQuotesResult = {
  ok: boolean;
  quotesUpserted: number;
  positionsConsidered: number;
  yahooSymbolsRequested: number;
  fetchedAt: string;
  message?: string;
};

function uniqueTickerCurrency(
  positions: { ticker: string; currency: string }[],
): { ticker: string; currency: string }[] {
  const key = (t: string, c: string) => `${t.toUpperCase()}|${c.toUpperCase()}`;
  const map = new Map<string, { ticker: string; currency: string }>();
  for (const p of positions) {
    const ticker = p.ticker.trim().toUpperCase();
    const currency = p.currency.trim().toUpperCase();
    if (!ticker) continue;
    map.set(key(ticker, currency), { ticker, currency });
  }
  return [...map.values()];
}

export async function refreshLiveQuotesForLatestImport(): Promise<RefreshLiveQuotesResult> {
  const latest = await getLatestDashboardImport();
  if (!latest?.positions.length) {
    return {
      ok: true,
      quotesUpserted: 0,
      positionsConsidered: 0,
      yahooSymbolsRequested: 0,
      fetchedAt: new Date().toISOString(),
      message: latest
        ? "Aucune position dans le dernier import portefeuille (seuls comptes sans titres ?)."
        : "Aucun import avec positions ou comptes — importe un export portefeuille Disnat.",
    };
  }

  const pairs = uniqueTickerCurrency(latest.positions);
  const disnatKeyToYahoo = new Map<string, { ticker: string; currency: string; yahoo: string }>();
  for (const { ticker, currency } of pairs) {
    const yahoo = disnatTickerToYahooSymbol(ticker, currency);
    disnatKeyToYahoo.set(`${ticker}|${currency}`, { ticker, currency, yahoo });
  }

  const yahooSymbols = [...new Set([...disnatKeyToYahoo.values()].map((v) => v.yahoo))];
  const prices = await fetchYahooQuotesBySymbol(yahooSymbols);
  const now = new Date();
  let quotesUpserted = 0;

  for (const { ticker, currency, yahoo } of disnatKeyToYahoo.values()) {
    const price = prices.get(yahoo);
    if (price === undefined) {
      continue;
    }

    await prisma.portfolioLiveQuote.upsert({
      where: {
        ticker_currency: { ticker, currency },
      },
      create: {
        ticker,
        currency,
        price,
        fetchedAt: now,
        yahooSymbol: yahoo,
      },
      update: {
        price,
        fetchedAt: now,
        yahooSymbol: yahoo,
      },
    });
    quotesUpserted += 1;
  }

  return {
    ok: true,
    quotesUpserted,
    positionsConsidered: pairs.length,
    yahooSymbolsRequested: yahooSymbols.length,
    fetchedAt: now.toISOString(),
  };
}
