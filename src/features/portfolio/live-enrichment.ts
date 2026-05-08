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
  /** Variation ($) par action lorsque le cours live Yahoo inclut regularMarketChange */
  quoteChangePerShare: number | null;
  /** Profits du jour ($) estimés si variation disponible */
  displayDayGainLoss: number | null;
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

function liveQuoteMatchesReference(livePrice: number, referencePrice: number | null): boolean {
  if (referencePrice === null || referencePrice <= 0) return true;
  const ratio = livePrice / referencePrice;
  return ratio >= LIVE_VS_REFERENCE_RATIO_MIN && ratio <= LIVE_VS_REFERENCE_RATIO_MAX;
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
    liveQuoteMatchesReference(rawLive, refUnit)
      ? rawLive
      : null;
  const displayPrice = livePrice ?? disnatMarketPrice;

  const displayMarketValue =
    displayPrice !== null && Number.isFinite(displayPrice) && position.quantity > 0
      ? position.quantity * displayPrice
      : disnatMarketValue;

  const usesLiveQuote = livePrice != null;
  const rawDelta = quote?.changeAmount ?? null;
  const quoteChangePerShare =
    usesLiveQuote &&
    rawDelta !== null &&
    Number.isFinite(rawDelta)
      ? rawDelta
      : null;
  const displayDayGainLoss =
    quoteChangePerShare !== null && position.quantity > 0
      ? quoteChangePerShare * position.quantity
      : null;

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
