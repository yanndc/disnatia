import { prisma } from "@/lib/db/prisma";
import { isTradingDayIso } from "@/lib/market/equity-session";
import { normalizeCurrency } from "@/lib/utils";
import { isoDateFromDbDate, parseIsoDateLocal } from "./daily-close-key";

/**
 * Détection des trous **réels** entre holdings et clôtures.
 *
 * Limite du compteur `missingPricesFilled` du backfill : il ne compte que les
 * dates renvoyées par Yahoo. Un jour où le titre est détenu mais où Yahoo ne
 * renvoie rien (ticker mal mappé, série incomplète) n'apparaît jamais.
 *
 * Ici on compare directement holdings (qty > 0) ↔ portfolio_daily_prices, avec un
 * **calendrier par marché reconstruit depuis les données** : `isTradingDayIso` ne
 * connaît que les fériés communs TSX+NYSE, donc Family Day, Victoria Day, July 4,
 * Thanksgiving US ou Juneteenth passeraient pour des trous. Une date est une séance
 * pour un marché si au moins `MIN_PAIRS_FOR_MARKET_SESSION` paires y ont une clôture.
 */

export type PriceGapMarket = "TSX" | "US";

/** Une séance « marché ouvert » exige au moins 2 paires cotées ce jour-là. */
export const MIN_PAIRS_FOR_MARKET_SESSION = 2;

export const DEFAULT_MAX_GAP_DATES_PER_PAIR = 12;

export type PriceGapPairDetail = {
  ticker: string;
  currency: string;
  market: PriceGapMarket;
  firstHeldDate: string;
  lastHeldDate: string;
  heldSessions: number;
  /** Séances détenues sans clôture alors que le marché était ouvert. */
  missingSessions: number;
  /** Échantillon borné des séances sans clôture. */
  missingDates: string[];
  lastCloseDate: string | null;
  /** Séances détenues après la dernière clôture connue (série arrêtée). */
  sessionsAfterLastClose: number;
};

export type PriceGapReport = {
  pairsChecked: number;
  heldSessionsChecked: number;
  missingSessions: number;
  pairsWithGaps: PriceGapPairDetail[];
  /** Paires sans aucune clôture alors qu'elles sont détenues (mapping suspect). */
  pairsWithoutAnyClose: PriceGapPairDetail[];
  /** Séances détenues non vérifiables (calendrier marché insuffisant). */
  unverifiedSessions: number;
  /** Holdings tombant un week-end / férié commun — ignorés. */
  ignoredNonTradingHoldingDates: number;
  marketSessions: Record<PriceGapMarket, number>;
};

export type PriceGapHoldingRow = {
  date: string;
  ticker: string;
  currency: string;
};

export type PriceGapPriceRow = {
  date: string;
  ticker: string;
  currency: string;
  /**
   * Source de la clôture. Les écritures `yahoo-live` sont exclues du calendrier
   * de marché : un rafraîchissement de cotation un jour de fermeture (NYSE/TSX)
   * réécrit la dernière cotation et fabriquerait une fausse séance.
   */
  source?: string;
};

export function priceGapPairKey(ticker: string, currency: string): string {
  return `${ticker.trim().toUpperCase()}|${normalizeCurrency(currency)}`;
}

export function priceGapMarketForCurrency(currency: string): PriceGapMarket {
  return normalizeCurrency(currency) === "USD" ? "US" : "TSX";
}


/** Cœur pur (testable) : holdings + clôtures → rapport de trous. */
export function buildPriceGapReport(
  holdings: PriceGapHoldingRow[],
  prices: PriceGapPriceRow[],
  options?: { maxDatesPerPair?: number },
): PriceGapReport {
  const maxDates = Math.max(
    1,
    options?.maxDatesPerPair ?? DEFAULT_MAX_GAP_DATES_PER_PAIR,
  );

  const closesByPair = new Map<string, Set<string>>();
  const pairsByMarket = new Map<PriceGapMarket, Set<string>>();
  const pairsPerMarketDate = new Map<string, Set<string>>();

  for (const price of prices) {
    const pair = priceGapPairKey(price.ticker, price.currency);
    const market = priceGapMarketForCurrency(price.currency);

    let closes = closesByPair.get(pair);
    if (!closes) {
      closes = new Set<string>();
      closesByPair.set(pair, closes);
    }
    closes.add(price.date);

    let marketPairs = pairsByMarket.get(market);
    if (!marketPairs) {
      marketPairs = new Set<string>();
      pairsByMarket.set(market, marketPairs);
    }
    marketPairs.add(pair);

    if (price.source === "yahoo-live") continue;

    const slot = `${market}|${price.date}`;
    let slotPairs = pairsPerMarketDate.get(slot);
    if (!slotPairs) {
      slotPairs = new Set<string>();
      pairsPerMarketDate.set(slot, slotPairs);
    }
    slotPairs.add(pair);
  }

  /* Seuil adaptatif : un marché suivi par une seule paire reste vérifiable. */
  const minPairsByMarket = new Map<PriceGapMarket, number>();
  for (const [market, pairs] of pairsByMarket) {
    minPairsByMarket.set(
      market,
      Math.min(MIN_PAIRS_FOR_MARKET_SESSION, pairs.size),
    );
  }

  const marketSessionDates = new Map<PriceGapMarket, Set<string>>();
  for (const [slot, pairs] of pairsPerMarketDate) {
    const separator = slot.indexOf("|");
    const market = slot.slice(0, separator) as PriceGapMarket;
    const date = slot.slice(separator + 1);
    const threshold =
      minPairsByMarket.get(market) ?? MIN_PAIRS_FOR_MARKET_SESSION;
    if (pairs.size < threshold) continue;
    let sessions = marketSessionDates.get(market);
    if (!sessions) {
      sessions = new Set<string>();
      marketSessionDates.set(market, sessions);
    }
    sessions.add(date);
  }

  const heldByPair = new Map<
    string,
    { ticker: string; currency: string; dates: Set<string> }
  >();
  const seenHeldKeys = new Set<string>();
  let ignoredNonTradingHoldingDates = 0;

  for (const holding of holdings) {
    const pair = priceGapPairKey(holding.ticker, holding.currency);
    const dedupeKey = `${pair}|${holding.date}`;
    if (seenHeldKeys.has(dedupeKey)) continue;
    seenHeldKeys.add(dedupeKey);

    if (!isTradingDayIso(holding.date)) {
      ignoredNonTradingHoldingDates += 1;
      continue;
    }

    let entry = heldByPair.get(pair);
    if (!entry) {
      entry = {
        ticker: holding.ticker.trim().toUpperCase(),
        currency: normalizeCurrency(holding.currency),
        dates: new Set<string>(),
      };
      heldByPair.set(pair, entry);
    }
    entry.dates.add(holding.date);
  }

  let heldSessionsChecked = 0;
  let missingSessions = 0;
  let unverifiedSessions = 0;
  const pairsWithGaps: PriceGapPairDetail[] = [];

  for (const [pair, entry] of heldByPair) {
    const market = priceGapMarketForCurrency(entry.currency);
    const closes = closesByPair.get(pair) ?? new Set<string>();
    const sessions = marketSessionDates.get(market) ?? new Set<string>();
    const heldDates = [...entry.dates].toSorted();

    const missingDates: string[] = [];
    for (const date of heldDates) {
      if (closes.has(date)) continue;
      if (sessions.has(date)) missingDates.push(date);
      else unverifiedSessions += 1;
    }

    const lastCloseDate =
      closes.size > 0 ? [...closes].toSorted().at(-1)! : null;
    const sessionsAfterLastClose = lastCloseDate
      ? heldDates.filter((date) => date > lastCloseDate).length
      : heldDates.length;

    heldSessionsChecked += heldDates.length;
    missingSessions += missingDates.length;

    if (missingDates.length === 0) continue;

    pairsWithGaps.push({
      ticker: entry.ticker,
      currency: entry.currency,
      market,
      firstHeldDate: heldDates[0]!,
      lastHeldDate: heldDates.at(-1)!,
      heldSessions: heldDates.length,
      missingSessions: missingDates.length,
      missingDates: missingDates.slice(0, maxDates),
      lastCloseDate,
      sessionsAfterLastClose,
    });
  }

  pairsWithGaps.sort((a, b) => b.missingSessions - a.missingSessions);

  return {
    pairsChecked: heldByPair.size,
    heldSessionsChecked,
    missingSessions,
    pairsWithGaps,
    pairsWithoutAnyClose: pairsWithGaps.filter(
      (pair) => pair.lastCloseDate == null,
    ),
    unverifiedSessions,
    ignoredNonTradingHoldingDates,
    marketSessions: {
      TSX: marketSessionDates.get("TSX")?.size ?? 0,
      US: marketSessionDates.get("US")?.size ?? 0,
    },
  };
}


/** Charge holdings détenus + clôtures et renvoie le rapport de trous. */
export async function findPriceGaps(options?: {
  maxDatesPerPair?: number;
}): Promise<PriceGapReport> {
  const [holdingRows, priceRows] = await Promise.all([
    prisma.portfolioDailyHolding.findMany({
      where: { quantity: { gt: 0 } },
      select: { holdingDate: true, ticker: true, currency: true },
      distinct: ["holdingDate", "ticker", "currency"],
    }),
    prisma.portfolioDailyPrice.findMany({
      select: { priceDate: true, ticker: true, currency: true, source: true },
      distinct: ["priceDate", "ticker", "currency", "source"],
    }),
  ]);

  return buildPriceGapReport(
    holdingRows.map((row) => ({
      date: isoDateFromDbDate(row.holdingDate),
      ticker: row.ticker,
      currency: row.currency,
    })),
    priceRows.map((row) => ({
      date: isoDateFromDbDate(row.priceDate),
      ticker: row.ticker,
      currency: row.currency,
      source: row.source,
    })),
    options,
  );
}

/** Titres détenus pour une séance donnée sans aucune clôture ce jour-là. */
export async function findTickersHeldWithoutCloseOnSession(
  sessionIso: string,
): Promise<{ ticker: string; currency: string }[]> {
  const day = parseIsoDateLocal(sessionIso);
  const [held, priced] = await Promise.all([
    prisma.portfolioDailyHolding.findMany({
      where: { holdingDate: day, quantity: { gt: 0 } },
      select: { ticker: true, currency: true },
      distinct: ["ticker", "currency"],
    }),
    prisma.portfolioDailyPrice.findMany({
      where: { priceDate: day },
      select: { ticker: true, currency: true },
      distinct: ["ticker", "currency"],
    }),
  ]);

  const pricedKeys = new Set(
    priced.map((row) => priceGapPairKey(row.ticker, row.currency)),
  );

  const missing = new Map<string, { ticker: string; currency: string }>();
  for (const row of held) {
    const key = priceGapPairKey(row.ticker, row.currency);
    if (pricedKeys.has(key) || missing.has(key)) continue;
    missing.set(key, {
      ticker: row.ticker.trim().toUpperCase(),
      currency: normalizeCurrency(row.currency),
    });
  }
  return [...missing.values()];
}
