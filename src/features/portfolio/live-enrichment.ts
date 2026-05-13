import type { PortfolioLiveQuote, PortfolioPosition } from "@/generated/prisma/client";

export type EnrichedPosition = PortfolioPosition & {
  accountName: string;
  /** Clé compte Disnat (alignée sur les transactions importées). */
  accountKey: string;
  /** Cours affiché : quote live si dispo, sinon import */
  displayPrice: number | null;
  /** Valeur affichée : qty × displayPrice si possible, sinon valeur import */
  displayMarketValue: number;
  disnatMarketValue: number;
  disnatMarketPrice: number | null;
  quoteFetchedAt: Date | null;
  usesLiveQuote: boolean;
  /**
   * Variation journalière ($ / action) d’après la cotation stockée (Yahoo/Stooq) :
   * `changeAmount` si présent, sinon `prix − clôture veille`.
   * Peut être renseignée même si le prix affiché reste un snapshot Disnat (mismatch possible).
   */
  quoteChangePerShare: number | null;
  /** Profits du jour ($) = variation × quantité lorsque la variation est connue */
  displayDayGainLoss: number | null;
  /**
   * Variation % de la séance d’après la cotation (Δ / clôture veille), indépendante du prix affiché snapshot.
   */
  quoteSessionChangePct: number | null;
};

export function indexQuotesByTickerCurrency(
  quotes: PortfolioLiveQuote[],
): Map<string, PortfolioLiveQuote> {
  const map = new Map<string, PortfolioLiveQuote>();
  for (const q of quotes) {
    map.set(`${q.ticker}|${q.currency}`, q);
  }
  return map;
}

const LIVE_VS_REFERENCE_RATIO_MAX = 4;
const LIVE_VS_REFERENCE_RATIO_MIN = 1 / LIVE_VS_REFERENCE_RATIO_MAX;

function referenceUnitPrice(position: PortfolioPosition): number | null {
  const fromMarket = position.marketPrice;
  if (fromMarket !== null && fromMarket > 0 && Number.isFinite(fromMarket)) {
    return fromMarket;
  }
  if (position.quantity > 0 && position.marketValue > 0) {
    const implied = position.marketValue / position.quantity;
    return Number.isFinite(implied) && implied > 0 ? implied : null;
  }
  return null;
}

function liveQuoteMatchesReference(
  livePrice: number,
  referencePrice: number | null,
  quotePreviousClose: number | null | undefined,
): boolean {
  if (referencePrice === null || referencePrice <= 0) return true;
  const ratio = livePrice / referencePrice;
  if (ratio >= LIVE_VS_REFERENCE_RATIO_MIN && ratio <= LIVE_VS_REFERENCE_RATIO_MAX) return true;
  /* Dernier prix Disnat souvent désuet (projection) : si Yahoo est cohérent avec la clôture précédente, faire confiance au live. */
  if (
    quotePreviousClose != null &&
    quotePreviousClose > 0 &&
    Number.isFinite(quotePreviousClose)
  ) {
    const vsPrev = livePrice / quotePreviousClose;
    if (vsPrev >= 0.92 && vsPrev <= 1.08) return true;
  }
  return false;
}

function sessionDeltaPerShareFromQuote(
  quote: PortfolioLiveQuote | undefined,
): number | null {
  if (!quote) return null;
  const direct = quote.changeAmount;
  if (direct !== null && Number.isFinite(direct)) {
    return direct;
  }
  const p = quote.price;
  const prev = quote.previousClose;
  if (
    p !== null &&
    Number.isFinite(p) &&
    prev !== null &&
    Number.isFinite(prev) &&
    prev > 0
  ) {
    return p - prev;
  }
  return null;
}

function sessionPctFromQuote(
  quote: PortfolioLiveQuote | undefined,
  deltaPerShare: number | null,
): number | null {
  if (deltaPerShare === null || !Number.isFinite(deltaPerShare) || !quote) {
    return null;
  }
  const prev = quote.previousClose;
  if (prev !== null && Number.isFinite(prev) && prev > 0) {
    return (deltaPerShare / prev) * 100;
  }
  const p = quote.price;
  if (p !== null && Number.isFinite(p)) {
    const inferredPrev = p - deltaPerShare;
    if (inferredPrev > 0) {
      return (deltaPerShare / inferredPrev) * 100;
    }
  }
  return null;
}

export function enrichPositionRow(
  position: PortfolioPosition & { accountKey?: string },
  accountName: string,
  quote: PortfolioLiveQuote | undefined,
): EnrichedPosition {
  const disnatMarketValue = position.marketValue;
  const disnatMarketPrice = position.marketPrice ?? null;
  const refUnit = referenceUnitPrice(position);
  const rawLive = quote?.price ?? null;
  const livePrice =
    rawLive !== null &&
    Number.isFinite(rawLive) &&
    liveQuoteMatchesReference(rawLive, refUnit, quote?.previousClose)
      ? rawLive
      : null;
  const displayPrice = livePrice ?? disnatMarketPrice;

  const displayMarketValue =
    displayPrice !== null && Number.isFinite(displayPrice) && position.quantity > 0
      ? position.quantity * displayPrice
      : disnatMarketValue;

  const usesLiveQuote = livePrice != null;
  const quoteChangePerShare = sessionDeltaPerShareFromQuote(quote);
  const displayDayGainLoss =
    quoteChangePerShare !== null && position.quantity > 0
      ? quoteChangePerShare * position.quantity
      : null;

  const quoteSessionChangePct = sessionPctFromQuote(quote, quoteChangePerShare);

  return {
    ...position,
    accountName,
    accountKey: position.accountKey ?? "",
    displayPrice,
    displayMarketValue,
    disnatMarketValue,
    disnatMarketPrice,
    quoteFetchedAt: quote?.fetchedAt ?? null,
    usesLiveQuote,
    quoteChangePerShare,
    displayDayGainLoss,
    quoteSessionChangePct,
  };
}

function totalPositionsDisplayValue(positions: EnrichedPosition[]): number {
  return positions.reduce((s, p) => s + p.displayMarketValue, 0);
}

export function withDisplayWeights(positions: EnrichedPosition[]): EnrichedPosition[] {
  const total = totalPositionsDisplayValue(positions);
  if (total <= 0) {
    return positions;
  }
  return positions.map((p) => ({
    ...p,
    weightPct: (p.displayMarketValue / total) * 100,
  }));
}
