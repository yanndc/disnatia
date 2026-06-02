import { prisma } from "@/lib/db/prisma";
import { disnatTickerToYahooSymbol } from "@/lib/market/disnat-ticker";
import {
  isoDateInToronto,
  priorSessionDateIso,
  referenceTradingSessionDayIso,
} from "@/lib/market/equity-session";
import { isoDateFromDbDate, parseIsoDateLocal } from "@/features/portfolio/daily-close-key";
import { subDays } from "date-fns";

export type PositionQuoteHistoryDay = {
  date: string;
  closePrice: number;
  source: string;
  yahooSymbol: string | null;
  /** Δ vs la date stockée juste avant (pas forcément la séance précédente). */
  changeVsPrevStored: number | null;
  changePctVsPrevStored: number | null;
};

export type PositionQuoteHistoryPayload = {
  ticker: string;
  currency: string;
  yahooSymbolMapped: string;
  referenceSessionDate: string;
  priorSessionDate: string;
  priorSessionCloseInDb: number | null;
  liveQuote: {
    price: number;
    changeAmount: number | null;
    previousClose: number | null;
    fetchedAt: string;
    yahooSymbol: string | null;
  } | null;
  /** Δ implicite si Positions utilisait ce live et la veille en base. */
  impliedSessionDelta: number | null;
  impliedSessionDeltaPct: number | null;
  days: number;
  dailyCloses: PositionQuoteHistoryDay[];
};

export async function getPositionQuoteHistory(
  ticker: string,
  currency: string,
  days = 60,
): Promise<PositionQuoteHistoryPayload> {
  const t = ticker.trim().toUpperCase();
  const c = currency.trim().toUpperCase();
  const span = Math.min(365, Math.max(7, Math.floor(days)));
  const now = new Date();

  const referenceSessionDate = referenceTradingSessionDayIso(now);
  const priorSessionDate = priorSessionDateIso(now);

  const [y, m, d] = referenceSessionDate.split("-").map(Number);
  const toDate = referenceSessionDate;
  const fromDate = isoDateInToronto(subDays(new Date(y!, m! - 1, d!), span));

  const rows = await prisma.portfolioDailyPrice.findMany({
    where: {
      ticker: t,
      currency: c,
      priceDate: {
        gte: parseIsoDateLocal(fromDate),
        lte: parseIsoDateLocal(toDate),
      },
    },
    orderBy: { priceDate: "desc" },
    select: {
      priceDate: true,
      closePrice: true,
      source: true,
      yahooSymbol: true,
    },
  });

  const priorSessionCloseInDb =
    rows.find((r) => isoDateFromDbDate(r.priceDate) === priorSessionDate)?.closePrice ?? null;

  const liveRow = await prisma.portfolioLiveQuote.findUnique({
    where: { ticker_currency: { ticker: t, currency: c } },
  });

  const sortedAsc = [...rows].sort((a, b) => a.priceDate.getTime() - b.priceDate.getTime());
  const dailyCloses: PositionQuoteHistoryDay[] = sortedAsc.map((row, i) => {
    const date = isoDateFromDbDate(row.priceDate);
    const prev = i > 0 ? sortedAsc[i - 1]! : null;
    let changeVsPrevStored: number | null = null;
    let changePctVsPrevStored: number | null = null;
    if (prev && prev.closePrice > 0) {
      changeVsPrevStored = row.closePrice - prev.closePrice;
      changePctVsPrevStored = (changeVsPrevStored / prev.closePrice) * 100;
    }
    return {
      date,
      closePrice: row.closePrice,
      source: row.source,
      yahooSymbol: row.yahooSymbol,
      changeVsPrevStored,
      changePctVsPrevStored,
    };
  });
  dailyCloses.reverse();

  const liveQuote = liveRow
    ? {
        price: liveRow.price,
        changeAmount: liveRow.changeAmount,
        previousClose: liveRow.previousClose,
        fetchedAt: liveRow.fetchedAt.toISOString(),
        yahooSymbol: liveRow.yahooSymbol,
      }
    : null;

  let impliedSessionDelta: number | null = null;
  let impliedSessionDeltaPct: number | null = null;
  if (
    liveQuote &&
    priorSessionCloseInDb != null &&
    priorSessionCloseInDb > 0 &&
    Number.isFinite(liveQuote.price)
  ) {
    impliedSessionDelta = liveQuote.price - priorSessionCloseInDb;
    impliedSessionDeltaPct = (impliedSessionDelta / priorSessionCloseInDb) * 100;
  }

  return {
    ticker: t,
    currency: c,
    yahooSymbolMapped: disnatTickerToYahooSymbol(t, c),
    referenceSessionDate,
    priorSessionDate,
    priorSessionCloseInDb,
    liveQuote,
    impliedSessionDelta,
    impliedSessionDeltaPct,
    days: span,
    dailyCloses,
  };
}
