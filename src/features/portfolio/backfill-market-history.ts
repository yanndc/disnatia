import { prisma } from "@/lib/db/prisma";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";
import { disnatTickerToYahooSymbol } from "@/lib/market/disnat-ticker";
import {
  fetchYahooChartDailyCloses,
  pickYahooChartRange,
} from "@/lib/market/yahoo-chart-closes";
import { isoDateInToronto, previousTradingDay, referenceTradingSessionDay } from "@/lib/market/equity-session";
import { normalizeCurrency } from "@/lib/utils";
import { projectHoldingsFromTransactions } from "./project-transaction-holdings";
import { dailyCloseKey, parseIsoDateLocal, isoDateLocal, isoDateFromDbDate } from "./daily-close-key";
import { recomputeAndPersistSessionGains } from "./performance-session-gains";

export type TickerCoverageRange = {
  ticker: string;
  currency: string;
  yahooSymbol: string;
  /** ISO YYYY-MM-DD — première détention connue */
  fromDate: string;
  /** ISO YYYY-MM-DD — dernière détention / aujourd'hui */
  toDate: string;
};

export type BackfillMarketHistoryResult = {
  ok: boolean;
  tickersProcessed: number;
  tickersSkipped: number;
  pricesUpserted: number;
  dailyValuesUpserted: number;
  sessionGainsUpserted: number;
  coverageRanges: TickerCoverageRange[];
  message?: string;
};

async function resolveTickerCoverageRanges(): Promise<TickerCoverageRange[]> {
  const today = isoDateInToronto(new Date());
  const grouped = await prisma.portfolioDailyHolding.groupBy({
    by: ["ticker", "currency"],
    where: { quantity: { gt: 0 } },
    _min: { holdingDate: true },
    _max: { holdingDate: true },
  });

  if (grouped.length > 0) {
    return grouped.map((row) => ({
      ticker: row.ticker.toUpperCase(),
      currency: normalizeCurrency(row.currency),
      yahooSymbol: disnatTickerToYahooSymbol(row.ticker, row.currency),
      fromDate: isoDateFromDbDate(row._min.holdingDate!),
      toDate: isoDateFromDbDate(row._max.holdingDate!) > today ? today : isoDateFromDbDate(row._max.holdingDate!),
    }));
  }

  const [holdings, earliestTx] = await Promise.all([
    prisma.portfolioHolding.findMany({
      where: { quantity: { gt: 0 } },
      select: { ticker: true, currency: true },
    }),
    prisma.portfolioTransactionLine.findFirst({
      where: { OR: [{ tradeDate: { not: null } }, { settlementDate: { not: null } }] },
      orderBy: [{ settlementDate: "asc" }, { tradeDate: "asc" }],
      select: { tradeDate: true, settlementDate: true },
    }),
  ]);

  const fallbackFrom =
    earliestTx?.settlementDate ?? earliestTx?.tradeDate ?? new Date();
  const fromDate = isoDateInToronto(fallbackFrom);

  const unique = new Map<string, TickerCoverageRange>();
  for (const h of holdings) {
    const ticker = h.ticker.toUpperCase();
    const currency = normalizeCurrency(h.currency);
    const key = `${ticker}|${currency}`;
    if (unique.has(key)) continue;
    unique.set(key, {
      ticker,
      currency,
      yahooSymbol: disnatTickerToYahooSymbol(ticker, currency),
      fromDate,
      toDate: today,
    });
  }
  return [...unique.values()];
}

const RECENT_TRADING_DAYS_TO_CHECK = 14;

/** Dernières séances ouvrées (référence incluse), ordre récent → ancien. */
function recentTradingSessionDates(now: Date, count: number): string[] {
  const out: string[] = [];
  let cursor = referenceTradingSessionDay(now);
  for (let i = 0; i < count; i++) {
    out.push(isoDateLocal(cursor));
    cursor = previousTradingDay(cursor, 1);
  }
  return out;
}

async function pairHasRecentPriceGap(
  ticker: string,
  currency: string,
  fromDate: string,
  now = new Date(),
): Promise<boolean> {
  const datesToCheck = recentTradingSessionDates(now, RECENT_TRADING_DAYS_TO_CHECK).filter(
    (d) => d >= fromDate,
  );
  if (datesToCheck.length === 0) return false;

  const rows = await prisma.portfolioDailyPrice.findMany({
    where: {
      ticker,
      currency,
      priceDate: { in: datesToCheck.map((d) => parseIsoDateLocal(d)) },
    },
    select: { priceDate: true },
  });
  const have = new Set(rows.map((r) => isoDateFromDbDate(r.priceDate)));
  return datesToCheck.some((d) => !have.has(d));
}

async function pairNeedsBackfill(
  ticker: string,
  currency: string,
  fromDate: string,
  force: boolean,
): Promise<boolean> {
  if (force) return true;

  const [earliest, latest, count] = await Promise.all([
    prisma.portfolioDailyPrice.findFirst({
      where: { ticker, currency },
      orderBy: { priceDate: "asc" },
      select: { priceDate: true },
    }),
    prisma.portfolioDailyPrice.findFirst({
      where: { ticker, currency },
      orderBy: { priceDate: "desc" },
      select: { priceDate: true },
    }),
    prisma.portfolioDailyPrice.count({ where: { ticker, currency } }),
  ]);

  if (!earliest || !latest || count < 5) return true;

  const from = parseIsoDateLocal(fromDate);
  const earliestIso = isoDateFromDbDate(earliest.priceDate);
  if (parseIsoDateLocal(earliestIso) > from) return true;

  if (await pairHasRecentPriceGap(ticker, currency, fromDate)) return true;

  const latestAgeDays =
    (Date.now() - latest.priceDate.getTime()) / (24 * 60 * 60 * 1000);
  return latestAgeDays > 5;
}

async function upsertDailyPrices(
  ticker: string,
  currency: string,
  yahooSymbol: string,
  points: { date: string; close: number }[],
): Promise<number> {
  let upserted = 0;
  for (const point of points) {
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
        source: "yahoo-chart",
        yahooSymbol,
      },
      update: {
        closePrice: point.close,
        source: "yahoo-chart",
        yahooSymbol,
      },
    });
    upserted += 1;
  }
  return upserted;
}

async function backfillPricesForPair(
  range: TickerCoverageRange,
  force: boolean,
): Promise<{ upserted: number; skipped: boolean }> {
  const needs = await pairNeedsBackfill(range.ticker, range.currency, range.fromDate, force);
  if (!needs) return { upserted: 0, skipped: true };

  const yahooRange = pickYahooChartRange(parseIsoDateLocal(range.fromDate));
  const raw = await fetchYahooChartDailyCloses(range.yahooSymbol, yahooRange);
  const from = parseIsoDateLocal(range.fromDate);
  const to = parseIsoDateLocal(range.toDate);

  const filtered = raw.filter((p) => {
    const d = parseIsoDateLocal(p.date);
    return d >= from && d <= to;
  });

  if (filtered.length === 0) return { upserted: 0, skipped: false };

  const upserted = await upsertDailyPrices(
    range.ticker,
    range.currency,
    range.yahooSymbol,
    filtered,
  );
  return { upserted, skipped: false };
}

async function recomputeDailyPortfolioValues(
  fromDate: string,
  toDate: string,
): Promise<number> {
  const from = parseIsoDateLocal(fromDate);
  const to = parseIsoDateLocal(toDate);

  const [holdings, prices] = await Promise.all([
    prisma.portfolioDailyHolding.findMany({
      where: {
        holdingDate: { gte: from, lte: to },
        quantity: { gt: 0 },
      },
      select: {
        holdingDate: true,
        ticker: true,
        currency: true,
        quantity: true,
      },
    }),
    prisma.portfolioDailyPrice.findMany({
      where: { priceDate: { gte: from, lte: to } },
      select: { ticker: true, currency: true, priceDate: true, closePrice: true },
    }),
  ]);

  const priceMap = new Map<string, number>();
  for (const p of prices) {
    priceMap.set(
      dailyCloseKey(p.ticker, p.currency, isoDateFromDbDate(p.priceDate)),
      p.closePrice,
    );
  }

  const byDateCurrency = new Map<string, { cad: number; usd: number }>();

  for (const h of holdings) {
    const dateIso = isoDateFromDbDate(h.holdingDate);
    const close = priceMap.get(
      dailyCloseKey(h.ticker, h.currency, dateIso),
    );
    if (close == null || !Number.isFinite(close)) continue;

    const value = h.quantity * close;
    const bucketKey = dateIso;
    const bucket = byDateCurrency.get(bucketKey) ?? { cad: 0, usd: 0 };
    if (normalizeCurrency(h.currency) === "USD") {
      bucket.usd += value;
    } else {
      bucket.cad += value;
    }
    byDateCurrency.set(bucketKey, bucket);
  }

  let upserted = 0;
  for (const [dateIso, totals] of byDateCurrency) {
    const valueDate = parseIsoDateLocal(dateIso);
    for (const [currency, positionsValue] of [
      ["CAD", totals.cad],
      ["USD", totals.usd],
    ] as const) {
      if (positionsValue <= 0) continue;
      await prisma.portfolioDailyValue.upsert({
        where: {
          valueDate_currency: { valueDate, currency },
        },
        create: {
          valueDate,
          currency,
          positionsValue,
          cashValue: 0,
          totalValue: positionsValue,
          source: "holdings-prices",
        },
        update: {
          positionsValue,
          totalValue: positionsValue,
          source: "holdings-prices",
        },
      });
      upserted += 1;
    }
  }

  return upserted;
}

export async function backfillMarketHistory(options?: {
  force?: boolean;
  recomputeDailyValues?: boolean;
  /** Limite le recalcul des valeurs journalières aux N derniers jours (cron). */
  recomputeDailyValuesDays?: number;
  recomputeSessionGains?: boolean;
  /** Limite le recalcul des gains de séance aux N derniers jours (cron). */
  recomputeSessionGainsDays?: number;
  ensureDailyHoldings?: boolean;
}): Promise<BackfillMarketHistoryResult> {
  const force = options?.force ?? false;
  const recomputeDailyValues = options?.recomputeDailyValues ?? true;
  const recomputeDailyValuesDays = options?.recomputeDailyValuesDays;
  const recomputeSessionGains = options?.recomputeSessionGains ?? true;
  const recomputeSessionGainsDays = options?.recomputeSessionGainsDays;
  const ensureDailyHoldings = options?.ensureDailyHoldings ?? true;

  if (ensureDailyHoldings) {
    const dailyCount = await prisma.portfolioDailyHolding.count();
    if (dailyCount === 0) {
      const txCount = await prisma.portfolioTransactionLine.count();
      if (txCount > 0) {
        await projectHoldingsFromTransactions();
      }
    }
  }

  const coverageRanges = await resolveTickerCoverageRanges();
  if (coverageRanges.length === 0) {
    return {
      ok: true,
      tickersProcessed: 0,
      tickersSkipped: 0,
      pricesUpserted: 0,
      dailyValuesUpserted: 0,
      sessionGainsUpserted: 0,
      coverageRanges: [],
      message:
        "Aucun titre détenu — importe des transactions ou lance d'abord le recalcul portefeuille.",
    };
  }

  let tickersProcessed = 0;
  let tickersSkipped = 0;
  let pricesUpserted = 0;

  const chunkSize = 4;
  for (let i = 0; i < coverageRanges.length; i += chunkSize) {
    const chunk = coverageRanges.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map((range) => backfillPricesForPair(range, force)),
    );
    for (const result of results) {
      if (result.skipped) tickersSkipped += 1;
      else tickersProcessed += 1;
      pricesUpserted += result.upserted;
    }
  }

  let dailyValuesUpserted = 0;
  const globalTo = isoDateInToronto(new Date());
  let globalFrom = coverageRanges.map((r) => r.fromDate).toSorted()[0]!;
  if (recomputeDailyValues) {
    if (recomputeDailyValuesDays != null && recomputeDailyValuesDays > 0) {
      const cutoff = isoDateInToronto(
        previousTradingDay(parseIsoDateLocal(globalTo), recomputeDailyValuesDays),
      );
      if (cutoff > globalFrom) globalFrom = cutoff;
    }
    dailyValuesUpserted = await recomputeDailyPortfolioValues(globalFrom, globalTo);
  }

  let sessionGainsUpserted = 0;
  if (recomputeSessionGains) {
    let gainsFrom = globalFrom;
    if (recomputeSessionGainsDays != null && recomputeSessionGainsDays > 0) {
      const cutoff = isoDateInToronto(
        previousTradingDay(parseIsoDateLocal(globalTo), recomputeSessionGainsDays),
      );
      if (cutoff > gainsFrom) gainsFrom = cutoff;
    }
    const disnatAccountKeys = (
      await prisma.portfolioAccountState.findMany({ select: { accountKey: true } })
    ).map((row) => row.accountKey);
    if (disnatAccountKeys.length > 0) {
      const fx = await getUsdCadRateNear(new Date());
      const wrote = await recomputeAndPersistSessionGains(
        disnatAccountKeys,
        gainsFrom,
        globalTo,
        fx?.usdToCad ?? null,
      );
      sessionGainsUpserted = wrote.rowsWritten;
    }
  }

  return {
    ok: true,
    tickersProcessed,
    tickersSkipped,
    pricesUpserted,
    dailyValuesUpserted,
    sessionGainsUpserted,
    coverageRanges,
    message: `${tickersProcessed} titre(s) mis à jour, ${tickersSkipped} déjà couverts, ${pricesUpserted} clôtures enregistrées.`,
  };
}
