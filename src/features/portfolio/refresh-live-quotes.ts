import { prisma } from "@/lib/db/prisma";
import { loadHoldingsForDashboard } from "@/features/portfolio/holdings-display-query";
import { disnatTickerToYahooSymbol } from "@/lib/market/disnat-ticker";
import { disnatTickerToStooqSymbol, fetchStooqLastClose } from "@/lib/market/stooq-quote";
import { fetchYahooQuotesBySymbol } from "@/lib/market/yahoo-quote";
import {
  persistQuoteSessionCloses,
} from "@/features/portfolio/daily-close-prices";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";
import { isoDateInToronto, previousTradingDay, referenceTradingSessionDay } from "@/lib/market/equity-session";
import { ensureDailyClosesPersistedForPairs } from "@/features/portfolio/daily-close-prices";
import { recomputeAndPersistSessionGains } from "@/features/portfolio/performance-session-gains";
import { subDays } from "date-fns";

export type RefreshLiveQuotesOptions = {
  /** Recalcule les P&L de séance persistés (cron EOD uniquement). */
  recomputeSessionGains?: boolean;
};

export type RefreshLiveQuotesResult = {
  ok: boolean;
  quotesUpserted: number;
  quotesMissing: number;
  positionsConsidered: number;
  yahooSymbolsRequested: number;
  stooqFilled: number;
  missingYahooSymbols: string[];
  fetchedAt: string;
  skipped?: boolean;
  quotesAsOf?: string;
  message?: string;
};

/** Date/heure du dernier fetch de cours en base (max `fetchedAt`). */
export async function getLatestQuotesFetchedAt(): Promise<Date | null> {
  const row = await prisma.portfolioLiveQuote.findFirst({
    orderBy: { fetchedAt: "desc" },
    select: { fetchedAt: true },
  });
  return row?.fetchedAt ?? null;
}

export function quotesAreStale(
  quotesAsOf: Date | null,
  maxAgeMinutes: number,
  now = Date.now(),
): boolean {
  if (maxAgeMinutes <= 0) return true;
  if (quotesAsOf === null) return true;
  return now - quotesAsOf.getTime() >= maxAgeMinutes * 60 * 1000;
}

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

export async function refreshLiveQuotesForLatestImport(
  options: RefreshLiveQuotesOptions = {},
): Promise<RefreshLiveQuotesResult> {
  const { recomputeSessionGains = false } = options;
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
  const quotesByYahoo = await fetchYahooQuotesBySymbol(yahooSymbols);
  const missingYahooSymbols = yahooSymbols.filter((symbol) => !quotesByYahoo.has(symbol));
  const now = new Date();
  let quotesUpserted = 0;
  let stooqFilled = 0;

  for (const { ticker, currency, yahoo } of disnatKeyToYahoo.values()) {
    let row = quotesByYahoo.get(yahoo);
    let sourceSymbol = yahoo;

    if (row === undefined) {
      const stooqSym = disnatTickerToStooqSymbol(ticker, currency);
      const stooqPrice = await fetchStooqLastClose(stooqSym);
      if (stooqPrice !== undefined) {
        row = { price: stooqPrice };
        sourceSymbol = `stooq:${stooqSym}`;
        stooqFilled += 1;
      }
    }

    const price = row?.price;
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
        changeAmount: row?.changeAmount ?? null,
        previousClose: row?.previousClose ?? null,
        fetchedAt: now,
        yahooSymbol: sourceSymbol,
      },
      update: {
        price,
        changeAmount: row?.changeAmount ?? null,
        previousClose: row?.previousClose ?? null,
        fetchedAt: now,
        yahooSymbol: sourceSymbol,
      },
    });
    if (row) {
      try {
        await persistQuoteSessionCloses(ticker, currency, sourceSymbol, row, now);
      } catch {
        /* clôture journalière optionnelle */
      }
    }
    quotesUpserted += 1;
  }

  const accountKeys = (
    await prisma.portfolioAccountState.findMany({ select: { accountKey: true } })
  ).map((a) => a.accountKey);
  if (recomputeSessionGains && accountKeys.length > 0 && quotesUpserted > 0) {
    const fx = await getUsdCadRateNear(now);
    const to = isoDateInToronto(now);
    const from = isoDateInToronto(subDays(now, 45));
    await recomputeAndPersistSessionGains(
      accountKeys,
      from,
      to,
      fx?.usdToCad ?? null,
    );
  }

  const priorDay = isoDateInToronto(
    previousTradingDay(referenceTradingSessionDay(now), 1),
  );
  await ensureDailyClosesPersistedForPairs(pairs, [priorDay]);

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
