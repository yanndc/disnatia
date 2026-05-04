import type { PortfolioLiveQuote, PortfolioPosition } from "@/generated/prisma/client";

export type EnrichedPosition = PortfolioPosition & {
  accountName: string;
  /** Cours affiché : quote live si dispo, sinon import */
  displayPrice: number | null;
  /** Valeur affichée : qty × displayPrice si possible, sinon valeur import */
  displayMarketValue: number;
  disnatMarketValue: number;
  disnatMarketPrice: number | null;
  quoteFetchedAt: Date | null;
  usesLiveQuote: boolean;
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

export function enrichPositionRow(
  position: PortfolioPosition,
  accountName: string,
  quote: PortfolioLiveQuote | undefined,
): EnrichedPosition {
  const disnatMarketValue = position.marketValue;
  const disnatMarketPrice = position.marketPrice ?? null;
  const livePrice = quote?.price ?? null;
  const displayPrice = livePrice ?? disnatMarketPrice;

  const displayMarketValue =
    displayPrice !== null && Number.isFinite(displayPrice) && position.quantity > 0
      ? position.quantity * displayPrice
      : disnatMarketValue;

  return {
    ...position,
    accountName,
    displayPrice,
    displayMarketValue,
    disnatMarketValue,
    disnatMarketPrice,
    quoteFetchedAt: quote?.fetchedAt ?? null,
    usesLiveQuote: quote != null,
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
