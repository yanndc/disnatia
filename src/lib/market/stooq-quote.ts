/**
 * Cours de repli via Stooq (CSV public, sans clé).
 * Complète Yahoo lorsque le symbole ne répond pas.
 */

import { canonicalDisnatStemForQuotes } from "@/lib/market/disnat-ticker";

export function disnatTickerToStooqSymbol(ticker: string, currency: string): string {
  const u = ticker.trim().toUpperCase();
  const cc = currency.trim().toUpperCase();
  let base = u.replace(/-C$/i, "").replace(/-U$/i, "").replace(/-T$/i, "");
  base = base.replace(/\.TO$/i, "");
  base = canonicalDisnatStemForQuotes(base.replace(/\./g, "-"));
  base = base.replace(/\./g, "-").toLowerCase();
  if (cc === "USD" || u.endsWith("-U")) {
    return `${base}.us`;
  }
  return `${base}.to`;
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
