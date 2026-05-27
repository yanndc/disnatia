import { prisma } from "@/lib/db/prisma";
import { disnatTickerToYahooSymbol } from "@/lib/market/disnat-ticker";
import { fetchYahooChartDailyCloses } from "@/lib/market/yahoo-chart-closes";
import {
  isoDateInToronto,
  previousTradingDay,
  referenceTradingSessionDay,
} from "@/lib/market/equity-session";
import type { YahooQuotePriceRow } from "@/lib/market/yahoo-quote";

export type DailyCloseKey = `${string}|${string}|${string}`;

export function dailyCloseKey(
  ticker: string,
  currency: string,
  date: string,
): DailyCloseKey {
  return `${ticker.toUpperCase()}|${currency.toUpperCase()}|${date}`;
}

function parseIsoDateLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function loadDailyCloseMap(
  tickers: { ticker: string; currency: string }[],
  fromDate: string,
  toDate: string,
): Promise<Map<DailyCloseKey, number>> {
  if (tickers.length === 0) return new Map();

  const pairs = [
    ...new Map(
      tickers.map((t) => [
        `${t.ticker.toUpperCase()}|${t.currency.toUpperCase()}`,
        { ticker: t.ticker.toUpperCase(), currency: t.currency.toUpperCase() },
      ]),
    ).values(),
  ];

  const rows = await prisma.portfolioDailyPrice.findMany({
    where: {
      OR: pairs.map((p) => ({ ticker: p.ticker, currency: p.currency })),
      priceDate: {
        gte: parseIsoDateLocal(fromDate),
        lte: parseIsoDateLocal(toDate),
      },
    },
    select: {
      ticker: true,
      currency: true,
      priceDate: true,
      closePrice: true,
    },
  });

  const map = new Map<DailyCloseKey, number>();
  for (const row of rows) {
    const date = isoDateLocal(row.priceDate);
    map.set(dailyCloseKey(row.ticker, row.currency, date), row.closePrice);
  }
  return map;
}

export async function persistQuoteSessionCloses(
  ticker: string,
  currency: string,
  yahooSymbol: string,
  row: YahooQuotePriceRow,
  now = new Date(),
): Promise<void> {
  const sessionDay = isoDateInToronto(now);
  const prevDay = isoDateLocal(previousTradingDay(parseIsoDateLocal(sessionDay), 1));

  const upserts: { date: string; close: number }[] = [];
  if (row.price != null && Number.isFinite(row.price) && row.price > 0) {
    upserts.push({ date: sessionDay, close: row.price });
  }
  if (
    row.previousClose != null &&
    Number.isFinite(row.previousClose) &&
    row.previousClose > 0
  ) {
    upserts.push({ date: prevDay, close: row.previousClose });
  }

  for (const point of upserts) {
    await prisma.portfolioDailyPrice.upsert({
      where: {
        ticker_currency_priceDate: {
          ticker,
          currency,
          priceDate: parseIsoDateLocal(point.date),
        },
      },
      create: {
        ticker,
        currency,
        priceDate: parseIsoDateLocal(point.date),
        closePrice: point.close,
        source: "yahoo-live",
        yahooSymbol,
      },
      update: {
        closePrice: point.close,
        source: "yahoo-live",
        yahooSymbol,
      },
    });
  }
}

export async function backfillDailyClosesForPairs(
  pairs: { ticker: string; currency: string; yahooSymbol: string }[],
): Promise<number> {
  const chartCloses = await fetchChartClosesInMemory(pairs);
  let upserted = 0;

  for (const [key, close] of chartCloses) {
    const [ticker, currency, date] = key.split("|");
    const yahooSymbol =
      pairs.find(
        (p) =>
          p.ticker.toUpperCase() === ticker &&
          p.currency.toUpperCase() === currency,
      )?.yahooSymbol ?? null;
    await prisma.portfolioDailyPrice.upsert({
      where: {
        ticker_currency_priceDate: {
          ticker: ticker!,
          currency: currency!,
          priceDate: parseIsoDateLocal(date!),
        },
      },
      create: {
        ticker: ticker!,
        currency: currency!,
        priceDate: parseIsoDateLocal(date!),
        closePrice: close,
        source: "yahoo-chart",
        yahooSymbol,
      },
      update: {
        closePrice: close,
        source: "yahoo-chart",
        yahooSymbol,
      },
    });
    upserted += 1;
  }

  return upserted;
}

/** Charge les clôtures Yahoo (10 j) en parallèle, sans écriture DB. */
export async function fetchChartClosesInMemory(
  pairs: { ticker: string; currency: string; yahooSymbol: string }[],
): Promise<Map<DailyCloseKey, number>> {
  const unique = [
    ...new Map(
      pairs.map((p) => [
        `${p.ticker.toUpperCase()}|${p.currency.toUpperCase()}`,
        {
          ticker: p.ticker.toUpperCase(),
          currency: p.currency.toUpperCase(),
          yahooSymbol: p.yahooSymbol,
        },
      ]),
    ).values(),
  ];

  const chunkSize = 6;
  const map = new Map<DailyCloseKey, number>();

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const batches = await Promise.all(
      chunk.map(async ({ ticker, currency, yahooSymbol }) => {
        const points = await fetchYahooChartDailyCloses(yahooSymbol);
        return points.map((point) => ({
          key: dailyCloseKey(ticker, currency, point.date),
          close: point.close,
        }));
      }),
    );
    for (const rows of batches) {
      for (const { key, close } of rows) {
        map.set(key, close);
      }
    }
  }

  return map;
}

/** Dates nécessaires pour le P&L « hier » (séance complétée + veille). */
export function yesterdayCloseDates(now = new Date()): {
  sessionEnd: string;
  sessionStart: string;
} {
  const ref = referenceTradingSessionDay(now);
  const sessionEnd = isoDateLocal(previousTradingDay(ref, 1));
  const sessionStart = isoDateLocal(previousTradingDay(parseIsoDateLocal(sessionEnd), 1));
  return { sessionEnd, sessionStart };
}

export function pairsMissingCloses(
  pairs: { ticker: string; currency: string }[],
  closeMap: Map<DailyCloseKey, number>,
  dates: string[],
): { ticker: string; currency: string }[] {
  const missing = new Set<string>();
  for (const { ticker, currency } of pairs) {
    for (const date of dates) {
      const key = dailyCloseKey(ticker, currency, date);
      if (!closeMap.has(key)) {
        missing.add(`${ticker.toUpperCase()}|${currency.toUpperCase()}`);
      }
    }
  }
  return [...missing].map((k) => {
    const [ticker, currency] = k.split("|");
    return { ticker: ticker!, currency: currency! };
  });
}

function closeInMap(
  closeMap: Map<DailyCloseKey, number>,
  ticker: string,
  currency: string,
  date: string,
): boolean {
  return closeMap.has(dailyCloseKey(ticker, currency, date));
}

/** Paires sans historique suffisant pour le P&L « hier » (fin + veille réelle). */
export function pairsNeedingChartHistory(
  pairs: { ticker: string; currency: string }[],
  closeMap: Map<DailyCloseKey, number>,
  sessionEnd: string,
): { ticker: string; currency: string }[] {
  const out: { ticker: string; currency: string }[] = [];
  for (const { ticker, currency } of pairs) {
    if (!closeInMap(closeMap, ticker, currency, sessionEnd)) {
      out.push({ ticker, currency });
      continue;
    }
    let cursor = parseIsoDateLocal(sessionEnd);
    let foundPrior = false;
    for (let i = 0; i < 8; i++) {
      cursor = previousTradingDay(cursor, 1);
      const iso = isoDateLocal(cursor);
      if (closeInMap(closeMap, ticker, currency, iso)) {
        foundPrior = true;
        break;
      }
    }
    if (!foundPrior) out.push({ ticker, currency });
  }
  return out;
}

export function yahooSymbolForPair(ticker: string, currency: string): string {
  return disnatTickerToYahooSymbol(ticker, currency);
}
