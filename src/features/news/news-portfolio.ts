import { prisma } from "@/lib/db/prisma";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";
import {
  disnatTickerToYahooSymbol,
  extractDisnatStemForPositionAggregation,
  normalizeDisnatTickerForPortfolio,
} from "@/lib/market/disnat-ticker";

/** Titre détenu, agrégé tous comptes confondus, valorisé en CAD. */
export type NewsPortfolioTicker = {
  /** Clé portefeuille normalisée (ex. `BCE-C`). */
  ticker: string;
  /** Tige courte utilisée comme libellé de badge (ex. `BCE`). */
  displayTicker: string;
  /** Tige d'agrégation (sert de clé de fusion entre variantes Disnat). */
  stem: string;
  yahooSymbol: string;
  securityName: string | null;
  sector: string | null;
  currency: string;
  valueCad: number;
  exposurePct: number;
};

export type NewsPortfolioContext = {
  tickers: NewsPortfolioTicker[];
  /** Placements Disnat (titres + encaisse) en CAD équivalent. */
  totalCad: number;
  usdToCad: number | null;
};

function toCad(value: number, currency: string, usdToCad: number | null): number {
  const cur = currency.trim().toUpperCase();
  if ((cur === "USD" || cur === "US") && usdToCad !== null) return value * usdToCad;
  return value;
}

/**
 * Contexte portefeuille du fil de nouvelles : valeur CAD par titre + exposition (%),
 * en réutilisant le dernier cours stocké quand il existe (sinon la valeur du snapshot d'import).
 */
export async function loadNewsPortfolioContext(): Promise<NewsPortfolioContext> {
  const [holdings, accountStates, quotes, fxRow] = await Promise.all([
    prisma.portfolioHolding.findMany({
      select: {
        ticker: true,
        currency: true,
        quantity: true,
        snapshotPrice: true,
        snapshotValue: true,
        securityName: true,
        sector: true,
      },
    }),
    prisma.portfolioAccountState.findMany({
      select: { currency: true, cashValue: true },
    }),
    prisma.portfolioLiveQuote
      .findMany({ select: { ticker: true, currency: true, price: true } })
      .catch(() => []),
    getUsdCadRateNear(null).catch(() => null),
  ]);

  const usdToCad = fxRow?.usdToCad ?? null;
  const quoteMap = new Map(
    quotes.map((q) => [`${q.ticker.toUpperCase()}|${q.currency.toUpperCase()}`, q.price]),
  );

  type Bucket = {
    valueCad: number;
    tickerVotes: Map<string, number>;
    displayTicker: string;
    yahooSymbol: string;
    securityName: string | null;
    sector: string | null;
    currency: string;
  };
  const buckets = new Map<string, Bucket>();

  for (const h of holdings) {
    const rawTicker = h.ticker?.trim();
    if (!rawTicker) continue;

    let stem: string;
    let ticker: string;
    let displayTicker: string;
    try {
      stem = extractDisnatStemForPositionAggregation(rawTicker);
      ticker = normalizeDisnatTickerForPortfolio(rawTicker, h.currency);
      displayTicker = stem;
    } catch {
      continue;
    }
    if (!stem) continue;

    const quotePrice = quoteMap.get(
      `${rawTicker.toUpperCase()}|${h.currency.toUpperCase()}`,
    );
    const quantity = Math.abs(h.quantity);
    const price = quotePrice ?? h.snapshotPrice ?? null;
    const valueNative =
      price !== null && Number.isFinite(price) && price > 0 && quantity > 0
        ? quantity * price
        : Math.abs(h.snapshotValue);
    if (!Number.isFinite(valueNative) || valueNative <= 0) continue;

    const valueCad = toCad(valueNative, h.currency, usdToCad);
    let bucket = buckets.get(stem);
    if (!bucket) {
      bucket = {
        valueCad: 0,
        tickerVotes: new Map(),
        displayTicker,
        yahooSymbol: safeYahooSymbol(rawTicker, h.currency),
        securityName: h.securityName ?? null,
        sector: h.sector ?? null,
        currency: h.currency,
      };
      buckets.set(stem, bucket);
    }
    bucket.valueCad += valueCad;
    bucket.tickerVotes.set(ticker, (bucket.tickerVotes.get(ticker) ?? 0) + valueCad);
    if (!bucket.securityName && h.securityName) bucket.securityName = h.securityName;
    if (!bucket.sector && h.sector) bucket.sector = h.sector;
  }

  const positionsCad = [...buckets.values()].reduce((sum, b) => sum + b.valueCad, 0);
  const cashCad = accountStates.reduce(
    (sum, a) => sum + toCad(a.cashValue, a.currency, usdToCad),
    0,
  );
  const totalCad = positionsCad + cashCad;
  const denom = totalCad > 0 ? totalCad : positionsCad;

  const tickers: NewsPortfolioTicker[] = [...buckets.entries()]
    .map(([stem, b]) => {
      const dominantTicker =
        [...b.tickerVotes.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? stem;
      return {
        ticker: dominantTicker,
        displayTicker: b.displayTicker,
        stem,
        yahooSymbol: b.yahooSymbol,
        securityName: b.securityName,
        sector: b.sector,
        currency: b.currency,
        valueCad: Math.round(b.valueCad * 100) / 100,
        exposurePct:
          denom > 0 ? Math.round((b.valueCad / denom) * 10_000) / 100 : 0,
      };
    })
    .sort((a, b) => b.valueCad - a.valueCad);

  return { tickers, totalCad: Math.round(totalCad * 100) / 100, usdToCad };
}

function safeYahooSymbol(ticker: string, currency: string): string {
  try {
    return disnatTickerToYahooSymbol(ticker, currency);
  } catch {
    return ticker.toUpperCase();
  }
}
