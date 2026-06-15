import { fetchYahooQuotesBySymbol } from "@/lib/market/yahoo-quote";

export type MarketIndexDefinition = {
  id: string;
  label: string;
  symbol: string;
  /** Affichage prix (indices = points, forex = taux). */
  kind: "index" | "forex";
};

export const MARKET_INDICES: MarketIndexDefinition[] = [
  { id: "tsx", label: "S&P/TSX", symbol: "^GSPTSE", kind: "index" },
  { id: "sp500", label: "S&P 500", symbol: "^GSPC", kind: "index" },
  { id: "nasdaq", label: "Nasdaq", symbol: "^IXIC", kind: "index" },
  { id: "usdcad", label: "USD/CAD", symbol: "USDCAD=X", kind: "forex" },
];

export type MarketIndexQuote = {
  id: string;
  label: string;
  symbol: string;
  kind: "index" | "forex";
  price: number | null;
  changeAmount: number | null;
  changePct: number | null;
};

export type MarketIndicesPayload = {
  ok: boolean;
  fetchedAt: string;
  quotes: MarketIndexQuote[];
};

function changePctFromPrice(
  price: number,
  changeAmount: number | null | undefined,
  previousClose: number | null | undefined,
): number | null {
  if (typeof changeAmount === "number" && Number.isFinite(changeAmount)) {
    const base =
      typeof previousClose === "number" &&
      Number.isFinite(previousClose) &&
      previousClose > 0
        ? previousClose
        : price - changeAmount;
    if (base > 0) return (changeAmount / base) * 100;
  }
  if (
    typeof previousClose === "number" &&
    Number.isFinite(previousClose) &&
    previousClose > 0
  ) {
    return ((price - previousClose) / previousClose) * 100;
  }
  return null;
}

export async function fetchMarketIndicesQuotes(): Promise<MarketIndicesPayload> {
  const symbols = MARKET_INDICES.map((i) => i.symbol);
  const rows = await fetchYahooQuotesBySymbol(symbols);
  const fetchedAt = new Date().toISOString();

  const quotes: MarketIndexQuote[] = MARKET_INDICES.map((def) => {
    const row = rows.get(def.symbol);
    if (!row || typeof row.price !== "number" || !Number.isFinite(row.price)) {
      return {
        id: def.id,
        label: def.label,
        symbol: def.symbol,
        kind: def.kind,
        price: null,
        changeAmount: null,
        changePct: null,
      };
    }
    const changeAmount =
      typeof row.changeAmount === "number" && Number.isFinite(row.changeAmount)
        ? row.changeAmount
        : null;
    return {
      id: def.id,
      label: def.label,
      symbol: def.symbol,
      kind: def.kind,
      price: row.price,
      changeAmount,
      changePct: changePctFromPrice(row.price, changeAmount, row.previousClose),
    };
  });

  return { ok: true, fetchedAt, quotes };
}
