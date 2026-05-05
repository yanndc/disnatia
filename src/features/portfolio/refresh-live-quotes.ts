import { prisma } from "@/lib/db/prisma";
import { loadHoldingsForDashboard } from "@/features/portfolio/holdings-display-query";
import { disnatTickerToYahooSymbol } from "@/lib/market/disnat-ticker";
import { disnatTickerToStooqSymbol, fetchStooqLastClose } from "@/lib/market/stooq-quote";
import { fetchYahooQuotesBySymbol } from "@/lib/market/yahoo-quote";

export type RefreshLiveQuotesResult = {
  ok: boolean;
  quotesUpserted: number;
  quotesMissing: number;
  positionsConsidered: number;
  yahooSymbolsRequested: number;
  stooqFilled: number;
  missingYahooSymbols: string[];
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
  const holdings = await loadHoldingsForDashboard();

  if (holdings.length === 0) {
    return {
      ok: true,
      quotesUpserted: 0,
      quotesMissing: 0,
      positionsConsidered: 0,
      yahooSymbolsRequested: 0,
      stooqFilled: 0,
      missingYahooSymbols: [],
      fetchedAt: new Date().toISOString(),
      message: "Aucune position à coter. Importe des transactions ou un export portefeuille.",
    };
  }

  const pairs = uniqueTickerCurrency(holdings);
  const disnatKeyToYahoo = new Map<string, { ticker: string; currency: string; yahoo: string }>();
  for (const { ticker, currency } of pairs) {
    const yahoo = disnatTickerToYahooSymbol(ticker, currency);
    disnatKeyToYahoo.set(`${ticker}|${currency}`, { ticker, currency, yahoo });
  }

  const yahooSymbols = [...new Set([...disnatKeyToYahoo.values()].map((v) => v.yahoo))];
  const prices = await fetchYahooQuotesBySymbol(yahooSymbols);
  const missingYahooSymbols = yahooSymbols.filter((symbol) => !prices.has(symbol));
  const now = new Date();
  let quotesUpserted = 0;
  let stooqFilled = 0;

  for (const { ticker, currency, yahoo } of disnatKeyToYahoo.values()) {
    let price = prices.get(yahoo);
    let sourceSymbol = yahoo;

    if (price === undefined) {
      const stooqSym = disnatTickerToStooqSymbol(ticker, currency);
      const stooqPrice = await fetchStooqLastClose(stooqSym);
      if (stooqPrice !== undefined) {
        price = stooqPrice;
        sourceSymbol = `stooq:${stooqSym}`;
        stooqFilled += 1;
      }
    }

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
        yahooSymbol: sourceSymbol,
      },
      update: {
        price,
        fetchedAt: now,
        yahooSymbol: sourceSymbol,
      },
    });
    quotesUpserted += 1;
  }

  return {
    ok: true,
    quotesUpserted,
    quotesMissing: pairs.length - quotesUpserted,
    positionsConsidered: pairs.length,
    yahooSymbolsRequested: yahooSymbols.length,
    stooqFilled,
    missingYahooSymbols: missingYahooSymbols.slice(0, 12),
    fetchedAt: now.toISOString(),
    message:
      quotesUpserted === 0
        ? "Aucun prix valide (Yahoo puis Stooq) pour ces symboles."
        : undefined,
  };
}
