import { disnatTickerToYahooSymbol } from "@/lib/market/disnat-ticker";
import { fetchYahooQuotesBySymbol } from "@/lib/market/yahoo-quote";

const MAX_SYMBOLS_PER_CALL = 20;

export type FetchLiveMarketQuotesInput = {
  yahooSymbols?: string[];
  disnatTickers?: { ticker: string; currency: string }[];
};

/**
 * Cours en direct (hors base) via Yahoo — même stack que le rafraîchissement portefeuille.
 */
export async function fetchLiveMarketQuotesForChat(input: FetchLiveMarketQuotesInput) {
  const yahooSet = new Set<string>();
  for (const s of input.yahooSymbols ?? []) {
    const t = s.trim();
    if (t) yahooSet.add(t);
  }
  for (const row of input.disnatTickers ?? []) {
    const y = disnatTickerToYahooSymbol(row.ticker, row.currency);
    yahooSet.add(y);
  }

  if (yahooSet.size === 0) {
    return {
      ok: false as const,
      message: "Fournis au moins un symbole Yahoo (ex. AAPL, XEG.TO) ou des paires ticker Disnat + devise.",
      fetchedAt: new Date().toISOString(),
    };
  }

  if (yahooSet.size > MAX_SYMBOLS_PER_CALL) {
    return {
      ok: false as const,
      message: `Maximum ${MAX_SYMBOLS_PER_CALL} symboles par appel.`,
      fetchedAt: new Date().toISOString(),
    };
  }

  const symbols = [...yahooSet];
  const map = await fetchYahooQuotesBySymbol(symbols);

  return {
    ok: true as const,
    fetchedAt: new Date().toISOString(),
    source: "Yahoo Finance (requête HTTP directe, données indicatives, peuvent être retardées ou indisponibles)",
    quotes: symbols.map((symbol) => {
      const row = map.get(symbol);
      return {
        symbol,
        found: Boolean(row),
        price: row?.price ?? null,
        changePerShare: row?.changeAmount ?? null,
        previousClose: row?.previousClose ?? null,
      };
    }),
  };
}

export type WebSearchTopic = "general" | "news" | "finance";

/**
 * Recherche web orientée contexte investisseur (nécessite TAVILY_API_KEY).
 */
export async function searchWebForBerta(query: string, topic: WebSearchTopic = "general") {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false as const,
      configured: false as const,
      message:
        "Recherche web désactivée : ajoute TAVILY_API_KEY sur le serveur (https://tavily.com) pour activer les sources externes.",
    };
  }

  const q = query.trim().slice(0, 400);
  if (q.length < 3) {
    return { ok: false as const, configured: true as const, message: "Requête trop courte (min. 3 caractères)." };
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: q,
      topic,
      max_results: 6,
      search_depth: "basic",
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false as const,
      configured: true as const,
      message: `Échec Tavily (HTTP ${response.status}). ${text.slice(0, 200)}`,
    };
  }

  const data = (await response.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      published_date?: string;
    }>;
  };

  const results = (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.content ?? "").slice(0, 1200),
    publishedDate: r.published_date ?? null,
  }));

  return {
    ok: true as const,
    configured: true as const,
    queriedAt: new Date().toISOString(),
    source: "Tavily Search",
    topic,
    results,
  };
}
