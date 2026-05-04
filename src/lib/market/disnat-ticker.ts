/**
 * Heuristique Disnat → symbole Yahoo (quote v7). À affiner selon tes exports réels.
 */
export function disnatTickerToYahooSymbol(ticker: string, currency: string): string {
  const raw = ticker.trim().toUpperCase();
  const cc = currency.trim().toUpperCase();
  const hyphen = raw.replace(/\./g, "-");

  if (raw.includes(".TO") || hyphen.endsWith(".TO")) {
    return raw.replace(/\s/g, "");
  }
  if (hyphen.endsWith("-T")) {
    return `${hyphen.replace(/-T$/, "")}.TO`;
  }
  if (hyphen.endsWith("-U")) {
    return hyphen.replace(/-U$/, "");
  }
  if (cc === "USD") {
    return hyphen;
  }
  if (cc === "CAD" && !raw.includes(".") && /^[A-Z0-9-]+$/.test(hyphen)) {
    return `${hyphen}.TO`;
  }

  return hyphen;
}
