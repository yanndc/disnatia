export type YahooQuotePriceRow = {
  price: number;
  changeAmount?: number;
  previousClose?: number;
};

type YahooQuoteResult = {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketPreviousClose?: number;
};

type YahooChartResult = {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        regularMarketPreviousClose?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: (number | null)[];
        }>;
      };
    }>;
  };
};

/**
 * Veille réelle = avant-dernière clôture daily du chart.
 * `meta.chartPreviousClose` est le début de la fenêtre Yahoo, pas J-1 (ex. SPY +13 $ au lieu de +2 $).
 */
export function previousCloseFromDailyChartBars(
  closes: (number | null | undefined)[],
): number | undefined {
  const valid: number[] = [];
  for (const close of closes) {
    if (typeof close === "number" && Number.isFinite(close) && close > 0) {
      valid.push(close);
    }
  }
  if (valid.length < 2) return undefined;
  return valid[valid.length - 2];
}

function resolvePreviousCloseFromChartMeta(
  barPreviousClose: number | undefined,
  regularMarketPreviousClose: number | undefined,
  chartPreviousClose: number | undefined,
): number | undefined {
  if (barPreviousClose != null && barPreviousClose > 0) return barPreviousClose;
  if (
    typeof regularMarketPreviousClose === "number" &&
    Number.isFinite(regularMarketPreviousClose) &&
    regularMarketPreviousClose > 0
  ) {
    return regularMarketPreviousClose;
  }
  if (
    typeof chartPreviousClose === "number" &&
    Number.isFinite(chartPreviousClose) &&
    chartPreviousClose > 0
  ) {
    return chartPreviousClose;
  }
  return undefined;
}

function sessionDeltaFromPriceAndPreviousClose(
  price: number,
  previousClose: number | undefined,
): Pick<YahooQuotePriceRow, "previousClose" | "changeAmount"> {
  if (previousClose == null || previousClose <= 0) return {};
  const changeAmount = price - previousClose;
  if (!Number.isFinite(changeAmount)) {
    return { previousClose };
  }
  return { previousClose, changeAmount };
}

/** Repli lorsque quote v7 ne répond pas : prix + veille dérivée des barres daily. */
async function fetchYahooChartFallback(
  symbol: string,
): Promise<YahooQuotePriceRow | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=1d&range=10d`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; DisnatIA/1.0)",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = (await response.json()) as YahooChartResult;
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== "number" || !Number.isFinite(price)) return null;

  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const barPreviousClose = previousCloseFromDailyChartBars(closes);
  const previousClose = resolvePreviousCloseFromChartMeta(
    barPreviousClose,
    meta?.regularMarketPreviousClose,
    meta?.chartPreviousClose,
  );

  return {
    price,
    ...sessionDeltaFromPriceAndPreviousClose(price, previousClose),
  };
}

function rowNeedsChartSessionFields(row: YahooQuotePriceRow): boolean {
  const hasChange =
    typeof row.changeAmount === "number" && Number.isFinite(row.changeAmount);
  const hasPrev =
    typeof row.previousClose === "number" &&
    Number.isFinite(row.previousClose) &&
    row.previousClose > 0;
  /* Delta du jour nécessaire : soit Yahoo envoie le change, soit la veille pour (prix − veille). */
  return !(hasChange || hasPrev);
}

function mergeYahooQuoteRow(
  quote: YahooQuotePriceRow,
  chart: YahooQuotePriceRow | null,
): YahooQuotePriceRow {
  if (!chart) return quote;
  const price = quote.price ?? chart.price;
  const prev =
    chart.previousClose ??
    (typeof quote.previousClose === "number" ? quote.previousClose : undefined);
  const derived =
    typeof price === "number" &&
    Number.isFinite(price) &&
    typeof prev === "number" &&
    prev > 0
      ? price - prev
      : undefined;
  let changeAmount = quote.changeAmount;
  if (!(typeof changeAmount === "number" && Number.isFinite(changeAmount))) {
    changeAmount = chart.changeAmount;
  }
  if (
    typeof derived === "number" &&
    Number.isFinite(derived) &&
    (!(typeof changeAmount === "number" && Number.isFinite(changeAmount)) ||
      Math.abs(changeAmount - derived) >
        Math.max(0.02, Math.abs(derived) * 0.25))
  ) {
    changeAmount = derived;
  }
  if (
    (!(typeof changeAmount === "number" && Number.isFinite(changeAmount))) &&
    typeof derived === "number" &&
    Number.isFinite(derived)
  ) {
    changeAmount = derived;
  }
  return {
    price,
    changeAmount,
    previousClose: prev ?? quote.previousClose,
  };
}

function rowFromYahooQuote(row: YahooQuoteResult): YahooQuotePriceRow | null {
  const price = row.regularMarketPrice;
  if (typeof price !== "number" || !Number.isFinite(price)) {
    return null;
  }
  const change =
    typeof row.regularMarketChange === "number" && Number.isFinite(row.regularMarketChange)
      ? row.regularMarketChange
      : undefined;
  const previousClose =
    typeof row.regularMarketPreviousClose === "number" &&
    Number.isFinite(row.regularMarketPreviousClose)
      ? row.regularMarketPreviousClose
      : undefined;
  return { price, changeAmount: change, previousClose };
}

/** Récupère les cours via l’API quote Yahoo (sans clé). Peut échouer côté réseau ou blocage. */
export async function fetchYahooQuotesBySymbol(
  symbols: string[],
): Promise<Map<string, YahooQuotePriceRow>> {
  const out = new Map<string, YahooQuotePriceRow>();
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
      if (!symbol) continue;
      const parsed = rowFromYahooQuote(row);
      if (parsed) {
        out.set(symbol, parsed);
      }
    }
  }

  for (const symbol of seen) {
    if (out.has(symbol)) continue;
    const row = await fetchYahooChartFallback(symbol);
    if (row !== null) {
      out.set(symbol, row);
    }
  }

  /** Si quote v7 n’envoie que le cours (souvent sur les .TO/.V), enrichir depuis chart (veille + delta). */
  for (const symbol of seen) {
    const row = out.get(symbol);
    if (!row || !rowNeedsChartSessionFields(row)) continue;
    const chart = await fetchYahooChartFallback(symbol);
    if (chart !== null) {
      out.set(symbol, mergeYahooQuoteRow(row, chart));
    }
  }

  return out;
}
