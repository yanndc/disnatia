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

function sessionPctFromDelta(
  deltaPerShare: number | null,
  priorClose: number | null,
  livePrice: number | null,
): number | null {
  if (deltaPerShare === null || !Number.isFinite(deltaPerShare)) {
    return null;
  }
  if (priorClose != null && priorClose > 0) {
    return (deltaPerShare / priorClose) * 100;
  }
  if (livePrice != null && Number.isFinite(livePrice)) {
    const inferredPrev = livePrice - deltaPerShare;
    if (inferredPrev > 0) {
      return (deltaPerShare / inferredPrev) * 100;
    }
  }
  return null;
}

function resolveSessionDeltaPerShare(
  livePrice: number,
  priorClose: number | null,
  changeAmount: number | null,
): number | null {
  if (changeAmount == null && priorClose == null) return null;
  if (changeAmount == null) {
    return priorClose != null ? livePrice - priorClose : null;
  }
  if (priorClose == null) return changeAmount;

  const derived = livePrice - priorClose;
  if (!Number.isFinite(derived)) return changeAmount;
  const tolerance = Math.max(0.02, Math.abs(derived) * 0.25);
  return Math.abs(changeAmount - derived) <= tolerance ? changeAmount : derived;
}

export function enrichPositionRow(
  position: PortfolioPosition & { accountKey?: string },
  accountName: string,
  quote: PortfolioLiveQuote | undefined,
  /** Clôture officielle de la séance précédente (portfolio_daily_prices). */
  priorSessionClose?: number | null,
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
  const priorClose =
    priorSessionClose != null &&
    Number.isFinite(priorSessionClose) &&
    priorSessionClose > 0
      ? priorSessionClose
      : null;

  const changeAmount =
    quote?.changeAmount != null && Number.isFinite(quote.changeAmount)
      ? quote.changeAmount
      : null;
  /** P&L séance : prix cotation vs clôture veille, même si le snapshot Disnat est trop désuet pour l’affichage. */
  const sessionQuotePrice =
    livePrice ??
    (rawLive != null &&
    Number.isFinite(rawLive) &&
    priorClose != null &&
    priorClose > 0
      ? rawLive
      : null);
  const sessionDeltaPerShare =
    sessionQuotePrice != null
      ? resolveSessionDeltaPerShare(sessionQuotePrice, priorClose, changeAmount)
      : null;

  const quoteChangePerShare = sessionDeltaPerShare;
  const displayDayGainLoss =
    sessionDeltaPerShare !== null && position.quantity > 0
      ? sessionDeltaPerShare * position.quantity
      : null;

  const quoteSessionChangePct = sessionPctFromDelta(
    sessionDeltaPerShare,
    priorClose,
    sessionQuotePrice,
  );

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
