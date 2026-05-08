/**
 * Variantes d’export Disnat pour le **même** titre (ex. achat 2022 en « BDRBD », opérations suivantes en « BBD »).
 * Sans ça, la projection crée deux clés et casse quantités / coûts. Même table sert pour Yahoo / Stooq.
 */
const DISNAT_BASE_TICKER_ALIASES: Record<string, string> = {
  BDRBD: "BBD",
};

/** Fusion stem titre : alias legacy + résolution cours externes. */
export function canonicalDisnatStemForQuotes(stem: string): string {
  const s = stem.trim().toUpperCase();
  return DISNAT_BASE_TICKER_ALIASES[s] ?? s;
}

/**
 * Tige stable pour fusionner des lignes Disnat qui parlent du **même** titre sous des libellés différents
 * (ex. achat `AMZN-U` devise US vs transfert `AMZN` devise CAN dans un compte en dollars canadiens).
 * Utilisée uniquement pour la clé d’agrégation des positions, pas pour l’affichage brut.
 */
export function extractDisnatStemForPositionAggregation(ticker: string): string {
  const raw = ticker.trim().toUpperCase();
  const withoutSuffix = raw.replace(/-U$/i, "").replace(/-C$/i, "");
  return canonicalDisnatStemForQuotes(withoutSuffix);
}

/**
 * Ticker utilisé pour **agrégation** (projection, import positions) : suffixe -C / -U + fusion des alias legacy
 * pour ne pas splitter une ligne à cause d’un seul vieux libellé Disnat (ex. BDRBD en 2022, BBD après).
 * L’historique brut importé peut encore afficher l’ancien code sur cette ligne ; la position courante est unifiée en BBD-C.
 */
export function normalizeDisnatTickerForPortfolio(
  ticker: string,
  currencyForQuote: string,
): string {
  const rawCur = currencyForQuote.trim().toUpperCase();
  const c =
    !rawCur || rawCur === "CAN" || rawCur === "CDN"
      ? "CAD"
      : rawCur === "US"
        ? "USD"
        : rawCur;

  const raw = ticker.trim().toUpperCase();
  if (c === "USD") {
    const stem = raw.replace(/-U$/, "");
    return canonicalDisnatStemForQuotes(stem);
  }
  if (c === "CAD") {
    let stem = raw.endsWith("-C") ? raw.slice(0, -2) : raw;
    /* Même titre que la variante -U : évite « AMZN-U-C » si jamais listingCurrency est CAD avec suffixe US. */
    stem = stem.replace(/-U$/i, "");
    const merged = canonicalDisnatStemForQuotes(stem);
    return merged.endsWith("-C") ? merged : `${merged}-C`;
  }
  return canonicalDisnatStemForQuotes(raw);
}

/**
 * Heuristique Disnat → symbole Yahoo (quote v7). À affiner selon tes exports réels.
 */
export function disnatTickerToYahooSymbol(ticker: string, currency: string): string {
  const raw = ticker.trim().toUpperCase();
  const cc = currency.trim().toUpperCase();
  const hyphen = raw.replace(/\./g, "-");

  if (raw.includes(".TO") || hyphen.endsWith(".TO")) {
    const compact = raw.replace(/\s/g, "");
    const stem = compact.replace(/\.TO$/i, "");
    return `${canonicalDisnatStemForQuotes(stem)}.TO`;
  }
  if (hyphen.endsWith("-T")) {
    return `${canonicalDisnatStemForQuotes(hyphen.replace(/-T$/, ""))}.TO`;
  }
  if (hyphen.endsWith("-C")) {
    return `${canonicalDisnatStemForQuotes(hyphen.replace(/-C$/, ""))}.TO`;
  }
  if (hyphen.endsWith("-U")) {
    return canonicalDisnatStemForQuotes(hyphen.replace(/-U$/, ""));
  }
  if (cc === "USD") {
    return canonicalDisnatStemForQuotes(hyphen);
  }
  if (cc === "CAD" && !raw.includes(".") && /^[A-Z0-9-]+$/.test(hyphen)) {
    return `${canonicalDisnatStemForQuotes(hyphen)}.TO`;
  }

  return canonicalDisnatStemForQuotes(hyphen);
}
