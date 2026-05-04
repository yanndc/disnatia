type YahooQuoteResult = {
  symbol?: string;
  regularMarketPrice?: number;
};

/** Récupère les cours via l’API quote Yahoo (sans clé). Peut échouer côté réseau ou blocage. */
export async function fetchYahooQuotesBySymbol(
  symbols: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const seen = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  const chunkSize = 35;

  for (let i = 0; i < seen.length; i += chunkSize) {
    const batch = seen.slice(i, i + chunkSize);
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
      batch.join(","),
    )}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DisnatIA/1.0)",
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      continue;
    }

    const data = (await response.json()) as {
      quoteResponse?: { result?: YahooQuoteResult[] };
    };

    for (const row of data.quoteResponse?.result ?? []) {
      const symbol = row.symbol;
      const price = row.regularMarketPrice;
      if (symbol && typeof price === "number" && Number.isFinite(price)) {
        out.set(symbol, price);
      }
    }
  }

  return out;
}
