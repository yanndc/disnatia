import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import {
  disnatTickerToYahooSymbol,
  extractDisnatStemForPositionAggregation,
} from "@/lib/market/disnat-ticker";
import { loadUsdCadRateMap, usdCadRateOnDate } from "@/lib/fx/usd-cad-rate-map";
import {
  fetchYahooChartDailyCloses,
  pickYahooChartRange,
} from "@/lib/market/yahoo-chart-closes";
import {
  addCalendarDays,
  isTradingDayIso,
  isoDateInToronto,
  previousTradingDay,
  referenceTradingSessionDay,
  referenceTradingSessionDayIso,
  subtractCalendarDays,
} from "@/lib/market/equity-session";
import { normalizeCurrency } from "@/lib/utils";
import { projectHoldingsFromTransactions } from "./project-transaction-holdings";
import { parseIsoDateLocal, isoDateLocal, isoDateFromDbDate } from "./daily-close-key";
import { recomputeAndPersistSessionGains } from "./performance-session-gains";
import { findPriceGaps, type PriceGapReport } from "./price-gap-detection";

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
  missingPricesFilled: number;
  dailyValuesUpserted: number;
  /** Détail du recalcul (reports, conversions devise, positions sans prix). */
  dailyValuesStats: DailyValueRecomputeStats | null;
  sessionGainsUpserted: number;
  /** Trous réels holdings ↔ clôtures après backfill (null si non calculé). */
  priceGaps: PriceGapReport | null;
  coverageRanges: TickerCoverageRange[];
  message?: string;
};

/**
 * Une ligne Disnat peut changer de devise de cotation en cours de route (`AMZN` en CAD
 * puis `AMZN-U` en USD) : on aligne la date de début de toutes les paires d'un même
 * titre sur la plus ancienne détention, sinon l'historique de la devise d'origine
 * n'est jamais téléchargé et la position reste sans prix sur la période initiale.
 */
function alignRangesOnStemStart(
  ranges: TickerCoverageRange[],
): TickerCoverageRange[] {
  const earliestByStem = new Map<string, string>();
  for (const range of ranges) {
    const stem = extractDisnatStemForPositionAggregation(range.ticker);
    const prev = earliestByStem.get(stem);
    if (!prev || range.fromDate < prev) earliestByStem.set(stem, range.fromDate);
  }
  return ranges.map((range) => {
    const stemStart = earliestByStem.get(
      extractDisnatStemForPositionAggregation(range.ticker),
    );
    if (!stemStart || stemStart >= range.fromDate) return range;
    return { ...range, fromDate: stemStart };
  });
}

async function resolveTickerCoverageRanges(now = new Date()): Promise<TickerCoverageRange[]> {
  const sessionEnd = referenceTradingSessionDayIso(now);
  const grouped = await prisma.portfolioDailyHolding.groupBy({
    by: ["ticker", "currency"],
    where: { quantity: { gt: 0 } },
    _min: { holdingDate: true },
    _max: { holdingDate: true },
  });

  if (grouped.length > 0) {
    const ranges = grouped.map((row) => ({
      ticker: row.ticker.toUpperCase(),
      currency: normalizeCurrency(row.currency),
      yahooSymbol: disnatTickerToYahooSymbol(row.ticker, row.currency),
      fromDate: isoDateFromDbDate(row._min.holdingDate!),
      toDate: sessionEnd,
    }));
    return alignRangesOnStemStart(ranges);
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
      toDate: sessionEnd,
    });
  }
  return [...unique.values()];
}

/**
 * Propage les holdings du dernier jour connu jusqu'à la séance attendue (sans rejouer
 * toutes les transactions). Rapide et fiable pour les crons Vercel.
 */
export async function extendDailyHoldingsToExpectedSession(
  now = new Date(),
): Promise<boolean> {
  const expectedSession = referenceTradingSessionDayIso(now);
  const maxRow = await prisma.portfolioDailyHolding.findFirst({
    orderBy: { holdingDate: "desc" },
    select: { holdingDate: true },
  });
  if (!maxRow) return false;

  const maxDateIso = isoDateFromDbDate(maxRow.holdingDate);
  if (maxDateIso >= expectedSession) return false;

  const sourceHoldings = await prisma.portfolioDailyHolding.findMany({
    where: {
      holdingDate: maxRow.holdingDate,
      quantity: { gt: 0 },
    },
  });
  if (sourceHoldings.length === 0) return false;

  const rows: {
    id: string;
    holdingDate: Date;
    accountKey: string;
    accountName: string | null;
    accountNumber: string | null;
    ticker: string;
    securityName: string | null;
    currency: string;
    quantity: number;
    averageCost: number | null;
    source: string;
    updatedAt: Date;
  }[] = [];

  let cursorIso = maxDateIso;
  while (cursorIso < expectedSession) {
    cursorIso = addCalendarDays(cursorIso, 1);
    const holdingDate = parseIsoDateLocal(cursorIso);
    for (const h of sourceHoldings) {
      rows.push({
        id: randomUUID(),
        holdingDate,
        accountKey: h.accountKey,
        accountName: h.accountName,
        accountNumber: h.accountNumber,
        ticker: h.ticker,
        securityName: h.securityName,
        currency: h.currency,
        quantity: h.quantity,
        averageCost: h.averageCost,
        source: h.source,
        updatedAt: new Date(),
      });
    }
  }

  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await prisma.portfolioDailyHolding.createMany({
      data: rows.slice(i, i + chunkSize),
      skipDuplicates: true,
    });
  }

  return rows.length > 0;
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
): Promise<{ upserted: number; missingFilled: number }> {
  const existing = await prisma.portfolioDailyPrice.findMany({
    where: {
      ticker,
      currency,
      priceDate: {
        in: points.map((point) => parseIsoDateLocal(point.date)),
      },
    },
    select: { priceDate: true },
  });
  const existingDates = new Set(existing.map((row) => isoDateFromDbDate(row.priceDate)));

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
  return {
    upserted,
    missingFilled: points.filter((point) => !existingDates.has(point.date)).length,
  };
}

async function backfillPricesForPair(
  range: TickerCoverageRange,
  force: boolean,
  hasKnownGaps = false,
): Promise<{ upserted: number; missingFilled: number; skipped: boolean }> {
  const needs =
    force ||
    hasKnownGaps ||
    (await pairNeedsBackfill(range.ticker, range.currency, range.fromDate, force));
  if (!needs) return { upserted: 0, missingFilled: 0, skipped: true };

  const yahooRange = pickYahooChartRange(parseIsoDateLocal(range.fromDate));
  const raw = await fetchYahooChartDailyCloses(range.yahooSymbol, yahooRange);
  const from = parseIsoDateLocal(range.fromDate);
  const to = parseIsoDateLocal(range.toDate);

  const filtered = raw.filter((p) => {
    const d = parseIsoDateLocal(p.date);
    return d >= from && d <= to;
  });

  if (filtered.length === 0) return { upserted: 0, missingFilled: 0, skipped: false };

  const result = await upsertDailyPrices(
    range.ticker,
    range.currency,
    range.yahooSymbol,
    filtered,
  );
  return { ...result, skipped: false };
}

/** Report maximal d'une clôture connue quand la séance n'a pas de prix. */
export const MAX_CLOSE_CARRY_FORWARD_DAYS = 10;

export type DailyValueRecomputeStats = {
  upserted: number;
  /** Positions valorisées avec la dernière clôture connue (report borné). */
  carriedForwardPositions: number;
  /** Positions valorisées via la paire sœur (autre devise) + taux USD/CAD. */
  crossCurrencyFilledPositions: number;
  /** Positions non valorisables (aucun prix trouvé) — avant, ignorées en silence. */
  unpricedPositions: number;
  /** Exemples de positions restées sans prix (borné). */
  unpricedSamples: { ticker: string; currency: string; date: string }[];
};

type PairCloseSeries = { date: string; close: number }[];

function pairKeyOf(ticker: string, currency: string): string {
  return `${ticker.trim().toUpperCase()}|${normalizeCurrency(currency)}`;
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  return Math.round(
    (parseIsoDateLocal(toIso).getTime() - parseIsoDateLocal(fromIso).getTime()) /
      86_400_000,
  );
}

/** Dernière clôture ≤ `dateIso` (série triée) ; null si la série commence après. */
function lastCloseOnOrBefore(
  series: PairCloseSeries | undefined,
  dateIso: string,
): { date: string; close: number } | null {
  if (!series || series.length === 0) return null;
  let lo = 0;
  let hi = series.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const entry = series[mid]!;
    if (entry.date <= dateIso) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best < 0 ? null : series[best]!;
}

/** Clôture exactement à `dateIso` (série triée). */
function exactCloseOn(
  series: PairCloseSeries | undefined,
  dateIso: string,
): number | null {
  const hit = lastCloseOnOrBefore(series, dateIso);
  if (!hit || hit.date !== dateIso) return null;
  return Number.isFinite(hit.close) && hit.close > 0 ? hit.close : null;
}

/**
 * Recalcule `portfolio_daily_values` sur une plage ISO.
 *
 * Trois garde-fous (avant, une position sans clôture était ignorée en silence,
 * ce qui sous-évaluait la valeur du jour et faussait les rendements) :
 * 1. clôture exacte du jour ;
 * 2. sinon paire sœur (même titre, autre devise) × taux USD/CAD du jour ;
 * 3. sinon report de la dernière clôture connue (max `MAX_CLOSE_CARRY_FORWARD_DAYS`).
 */
export async function recomputeDailyPortfolioValuesDetailed(
  fromDate: string,
  toDate: string,
  options?: { dryRun?: boolean },
): Promise<DailyValueRecomputeStats> {
  const from = parseIsoDateLocal(fromDate);
  const to = parseIsoDateLocal(toDate);
  const lookbackIso = subtractCalendarDays(
    fromDate,
    MAX_CLOSE_CARRY_FORWARD_DAYS + 10,
  );

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
      where: { priceDate: { gte: parseIsoDateLocal(lookbackIso), lte: to } },
      select: { ticker: true, currency: true, priceDate: true, closePrice: true },
    }),
  ]);

  const seriesByPair = new Map<string, PairCloseSeries>();
  const pairsByStem = new Map<string, Map<string, string>>();
  for (const p of prices) {
    const key = pairKeyOf(p.ticker, p.currency);
    let series = seriesByPair.get(key);
    if (!series) {
      series = [];
      seriesByPair.set(key, series);
    }
    series.push({ date: isoDateFromDbDate(p.priceDate), close: p.closePrice });

    const stem = extractDisnatStemForPositionAggregation(p.ticker);
    let currencies = pairsByStem.get(stem);
    if (!currencies) {
      currencies = new Map<string, string>();
      pairsByStem.set(stem, currencies);
    }
    currencies.set(normalizeCurrency(p.currency), key);
  }
  for (const series of seriesByPair.values()) {
    series.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  let rateMapPromise: Promise<Map<string, number>> | null = null;
  function getRateMap(): Promise<Map<string, number>> {
    rateMapPromise ??= loadUsdCadRateMap(lookbackIso, toDate);
    return rateMapPromise;
  }

  const stats: DailyValueRecomputeStats = {
    upserted: 0,
    carriedForwardPositions: 0,
    crossCurrencyFilledPositions: 0,
    unpricedPositions: 0,
    unpricedSamples: [],
  };
  const byDateCurrency = new Map<string, { cad: number; usd: number }>();

  for (const h of holdings) {
    const dateIso = isoDateFromDbDate(h.holdingDate);
    /* Les holdings sont projetés sur tous les jours calendrier : une ligne de
       week-end / férié commun ne doit pas créer de valeur journalière. */
    if (!isTradingDayIso(dateIso)) continue;

    const currency = normalizeCurrency(h.currency);
    const pairKey = pairKeyOf(h.ticker, currency);

    let close = exactCloseOn(seriesByPair.get(pairKey), dateIso);

    if (close == null) {
      const stem = extractDisnatStemForPositionAggregation(h.ticker);
      const siblingCurrency = currency === "USD" ? "CAD" : "USD";
      const siblingKey = pairsByStem.get(stem)?.get(siblingCurrency);
      const siblingClose = siblingKey
        ? exactCloseOn(seriesByPair.get(siblingKey), dateIso)
        : null;
      if (siblingClose != null) {
        const rate = usdCadRateOnDate(await getRateMap(), dateIso);
        if (rate != null && rate > 0) {
          close = currency === "USD" ? siblingClose / rate : siblingClose * rate;
          stats.crossCurrencyFilledPositions += 1;
        }
      }
    }

    if (close == null) {
      const previous = lastCloseOnOrBefore(seriesByPair.get(pairKey), dateIso);
      if (
        previous &&
        daysBetweenIso(previous.date, dateIso) <= MAX_CLOSE_CARRY_FORWARD_DAYS
      ) {
        close = previous.close;
        stats.carriedForwardPositions += 1;
      }
    }

    if (close == null || !Number.isFinite(close) || close <= 0) {
      stats.unpricedPositions += 1;
      if (stats.unpricedSamples.length < 10) {
        stats.unpricedSamples.push({
          ticker: h.ticker,
          currency,
          date: dateIso,
        });
      }
      continue;
    }

    const value = h.quantity * close;
    const bucket = byDateCurrency.get(dateIso) ?? { cad: 0, usd: 0 };
    if (currency === "USD") {
      bucket.usd += value;
    } else {
      bucket.cad += value;
    }
    byDateCurrency.set(dateIso, bucket);
  }

  for (const [dateIso, totals] of byDateCurrency) {
    const valueDate = parseIsoDateLocal(dateIso);
    for (const [currency, positionsValue] of [
      ["CAD", totals.cad],
      ["USD", totals.usd],
    ] as const) {
      if (positionsValue <= 0) continue;
      if (!options?.dryRun) {
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
      }
      stats.upserted += 1;
    }
  }

  return stats;
}

/** Recalcule `portfolio_daily_values` et renvoie le nombre de lignes écrites. */
export async function recomputeDailyPortfolioValues(
  fromDate: string,
  toDate: string,
): Promise<number> {
  const stats = await recomputeDailyPortfolioValuesDetailed(fromDate, toDate);
  return stats.upserted;
}

export type EnsureDailyHoldingsResult = {
  projected: boolean;
  reason?: "empty" | "stale";
};

/** Projette les holdings journaliers si la table est vide ou en retard sur la séance attendue. */
export async function ensureDailyHoldingsUpToDate(
  now = new Date(),
): Promise<EnsureDailyHoldingsResult> {
  const expectedSession = referenceTradingSessionDayIso(now);

  const [dailyCount, maxHoldingRow, txCount] = await Promise.all([
    prisma.portfolioDailyHolding.count(),
    prisma.portfolioDailyHolding.findFirst({
      orderBy: { holdingDate: "desc" },
      select: { holdingDate: true },
    }),
    prisma.portfolioTransactionLine.count(),
  ]);

  if (txCount === 0) return { projected: false };

  const maxHoldingDate = maxHoldingRow?.holdingDate
    ? isoDateFromDbDate(maxHoldingRow.holdingDate)
    : null;

  if (!maxHoldingDate || maxHoldingDate < expectedSession) {
    if (dailyCount === 0) {
      await projectHoldingsFromTransactions();
      return { projected: true, reason: "empty" };
    }

    const extended = await extendDailyHoldingsToExpectedSession(now);
    if (!extended) {
      await projectHoldingsFromTransactions();
      return { projected: true, reason: "stale" };
    }

    const afterMax = await prisma.portfolioDailyHolding.findFirst({
      orderBy: { holdingDate: "desc" },
      select: { holdingDate: true },
    });
    const afterIso = afterMax?.holdingDate
      ? isoDateFromDbDate(afterMax.holdingDate)
      : null;
    if (!afterIso || afterIso < expectedSession) {
      await projectHoldingsFromTransactions();
    }
    return { projected: true, reason: "stale" };
  }

  return { projected: false };
}

/** Fenêtre glissante pour le cron EOD (séance du jour incluse). */
export async function recomputeRecentDailyPortfolioValues(
  trailingTradingDays = 7,
  now = new Date(),
): Promise<number> {
  const toDate = referenceTradingSessionDayIso(now);
  const fromDate = isoDateInToronto(
    previousTradingDay(parseIsoDateLocal(toDate), trailingTradingDays),
  );
  return recomputeDailyPortfolioValues(fromDate, toDate);
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
  const now = new Date();
  const force = options?.force ?? false;
  const recomputeDailyValues = options?.recomputeDailyValues ?? true;
  const recomputeDailyValuesDays = options?.recomputeDailyValuesDays;
  const recomputeSessionGains = options?.recomputeSessionGains ?? true;
  const recomputeSessionGainsDays = options?.recomputeSessionGainsDays;
  const ensureDailyHoldings = options?.ensureDailyHoldings ?? true;

  if (ensureDailyHoldings) {
    await ensureDailyHoldingsUpToDate(now);
  }

  const coverageRanges = await resolveTickerCoverageRanges(now);
  if (coverageRanges.length === 0) {
    return {
      ok: true,
      tickersProcessed: 0,
      tickersSkipped: 0,
      pricesUpserted: 0,
      missingPricesFilled: 0,
      dailyValuesUpserted: 0,
      dailyValuesStats: null,
      sessionGainsUpserted: 0,
      priceGaps: null,
      coverageRanges: [],
      message:
        "Aucun titre détenu — importe des transactions ou lance d'abord le recalcul portefeuille.",
    };
  }

  /* Trous réels avant téléchargement : holdings ↔ clôtures (pas seulement ce que Yahoo renvoie). */
  const gapsBefore = await findPriceGaps({ maxDatesPerPair: 20 });
  const pairsWithGaps = new Set(
    gapsBefore.pairsWithGaps.map((pair) =>
      pairKeyOf(pair.ticker, pair.currency),
    ),
  );

  let tickersProcessed = 0;
  let tickersSkipped = 0;
  let pricesUpserted = 0;
  let missingPricesFilled = 0;

  const chunkSize = 4;
  for (let i = 0; i < coverageRanges.length; i += chunkSize) {
    const chunk = coverageRanges.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map((range) =>
        backfillPricesForPair(
          range,
          force,
          pairsWithGaps.has(pairKeyOf(range.ticker, range.currency)),
        ),
      ),
    );
    for (const result of results) {
      if (result.skipped) tickersSkipped += 1;
      else tickersProcessed += 1;
      pricesUpserted += result.upserted;
      missingPricesFilled += result.missingFilled;
    }
  }

  let dailyValuesUpserted = 0;
  let dailyValuesStats: DailyValueRecomputeStats | null = null;
  const globalTo = referenceTradingSessionDayIso(now);
  let globalFrom = coverageRanges.map((r) => r.fromDate).toSorted()[0]!;
  if (recomputeDailyValues) {
    if (recomputeDailyValuesDays != null && recomputeDailyValuesDays > 0) {
      const cutoff = isoDateInToronto(
        previousTradingDay(parseIsoDateLocal(globalTo), recomputeDailyValuesDays),
      );
      if (cutoff > globalFrom) globalFrom = cutoff;
    }
    dailyValuesStats = await recomputeDailyPortfolioValuesDetailed(
      globalFrom,
      globalTo,
    );
    dailyValuesUpserted = dailyValuesStats.upserted;
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
      const wrote = await recomputeAndPersistSessionGains(
        disnatAccountKeys,
        gainsFrom,
        globalTo,
      );
      sessionGainsUpserted = wrote.rowsWritten;
    }
  }

  const priceGaps = await findPriceGaps({ maxDatesPerPair: 20 });

  const gapMessage =
    priceGaps.missingSessions === 0
      ? `Trous réels : aucun (${priceGaps.heldSessionsChecked} séance(s) détenue(s) vérifiée(s)).`
      : `Trous réels : ${priceGaps.missingSessions} séance(s) détenue(s) sans clôture sur ${priceGaps.heldSessionsChecked} vérifiée(s) — ${priceGaps.pairsWithGaps.length} paire(s).`;

  return {
    ok: true,
    tickersProcessed,
    tickersSkipped,
    pricesUpserted,
    missingPricesFilled,
    dailyValuesUpserted,
    dailyValuesStats,
    sessionGainsUpserted,
    priceGaps,
    coverageRanges,
    message: `${tickersProcessed} titre(s) mis à jour, ${tickersSkipped} déjà couverts, ${missingPricesFilled} clôture(s) téléchargée(s) absente(s) en base, ${pricesUpserted} clôtures enregistrées. ${gapMessage}`,
  };
}
