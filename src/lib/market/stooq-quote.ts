/**
 * Cours de repli via Stooq (CSV public, sans clé).
 * Complète Yahoo lorsque le symbole ne répond pas.
 */

import {
  canonicalDisnatStemForQuotes,
  stripDisnatListingDenominationHyphens,
  stripTrailingCanadianDenominationHyphens,
  standardizeDisnatTickerMarketDots,
} from "@/lib/market/disnat-ticker";

/** Repli Stooq : certains stems `.to` n’existent pas pour des titres NEO (ex. HISA → `hisa.ne`). */
const STOOQ_SYMBOL_OVERRIDES: Record<string, string> = {
  "hisa.to": "hisa.ne",
};

export function disnatTickerToStooqSymbol(ticker: string, currency: string): string {
  const u = standardizeDisnatTickerMarketDots(ticker).toUpperCase();
  const cc = currency.trim().toUpperCase();

  let h = u.replace(/\./g, "-").replace(/-TO$/i, "");
  const listedUsd = cc === "USD" || /-U$/i.test(h);
  if (listedUsd) {
    while (/-U$/i.test(h) && h.length > 2) {
      h = h.slice(0, -2);
    }
  } else {
    h = stripTrailingCanadianDenominationHyphens(h);
  }
  h = stripDisnatListingDenominationHyphens(h);

  const base = canonicalDisnatStemForQuotes(h.replace(/\./g, "-"))
    .replace(/\./g, "-")
    .toLowerCase();

  if (listedUsd) {
    return `${base}.us`;
  }
  const primary = `${base}.to`;
  return STOOQ_SYMBOL_OVERRIDES[primary] ?? primary;
}

/** Dernière clôture : parse la dernière ligne du CSV renvoyé par Stooq. */
export async function fetchStooqLastClose(stooqSymbol: string): Promise<number | undefined> {
  const symbol = stooqSymbol.trim().toLowerCase();
  if (!symbol) return undefined;

  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; DisnatIA/1.0)",
      Accept: "text/csv,text/plain,*/*",
    },
    cache: "no-store",
  });

  if (!response.ok) return undefined;

  const text = await response.text();
  const lines = text
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return undefined;

  const dataLine = lines[lines.length - 1];
  const parts = dataLine.split(",");
  if (parts.length < 7) return undefined;

  const closeStr = parts[6]?.trim();
  if (!closeStr) return undefined;
  const close = Number.parseFloat(closeStr.replace(",", "."));
  return Number.isFinite(close) && close > 0 ? close : undefined;
}
