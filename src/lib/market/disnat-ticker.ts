/**
 * Variantes d’export Disnat pour le **même** titre (ex. réorganisation en « BDRBD » pour la série B TSX).
 * `BDRBD` → `BBD.B` : même ligne que `BBD.B-C` / Yahoo `BBD-B.TO`, pas le cours « BBD » nu (`BBD.TO`).
 */
const DISNAT_BASE_TICKER_ALIASES: Record<string, string> = {
  BDRBD: "BBD.B",
};

/**
 * Titres en dollars canadiens **hors TSX primaire** (NEO / Cboe Canada, etc.).
 * L’heuristique par défaut ajoute `.TO` ; ces symboles doivent rester explicitement corrects pour Yahoo/Stooq.
 */
const DISNAT_CAD_SPECIAL_YAHOO_SYMBOL: Record<string, string> = {
  /** Compte épargne à intérêt élevé coté NEO (HISA.NE), pas HISA.TO. */
  HISA: "HISA.NE",
};

/**
 * Certaines lignes Disnat utilisent une notation décimale pour la cote : « BBD.C » = « BBD-C » ;
 * même chose pour `.U` / `.T`. On évite ainsi des tickers fourre-tout (« BBD.C-C ») et des symboles Yahoo invalides.
 * Le suffixe bourse littéral `.TO` est conservé (ex. gabarits explicites coté Toronto).
 */
export function standardizeDisnatTickerMarketDots(ticker: string): string {
  let t = ticker.trim().toUpperCase();
  const hasToExchangeSuffix = /\.TO$/i.test(t);
  let core = hasToExchangeSuffix ? t.replace(/\.TO$/i, "") : t;
  let prev = "";
  while (prev !== core) {
    prev = core;
    core = core.replace(/\.([CUT])(?=(-|$))/i, (_, letter: string) => `-${letter.toUpperCase()}`);
  }
  t = hasToExchangeSuffix ? `${core}.TO` : core;
  return t.toUpperCase();
}

/**
 * Retire en chaîne les suffixes de cotation reconnus en fin de symbole (ex. plusieurs « -C » consécutifs,
 * issue d’anciens bugs ou d’imports mixtes.)
 */
export function stripDisnatListingDenominationHyphens(normalizedTicker: string): string {
  let h = normalizedTicker.trim().toUpperCase().replace(/\./g, "-");
  let prev = "";
  while (prev !== h) {
    prev = h;
    if (h.endsWith("-U")) {
      h = h.slice(0, -2);
    } else if (h.endsWith("-C")) {
      h = h.slice(0, -2);
    } else if (h.endsWith("-T")) {
      h = h.slice(0, -2);
    }
  }
  return h;
}

/** Pour Yahoo/Stooq seule la dénomination canadienne « -C » peut être empilée (ex. `BBD-C-C`). */
export function stripTrailingCanadianDenominationHyphens(normalizedTicker: string): string {
  let h = normalizedTicker.trim().toUpperCase().replace(/\./g, "-");
  while (h.endsWith("-C") && h.length > 2) {
    const next = h.slice(0, -2);
    if (next === h) break;
    h = next;
  }
  return h;
}

/** Fusion stem titre : alias legacy + résolution cours externes. */
export function canonicalDisnatStemForQuotes(stem: string): string {
  const s = stem.trim().toUpperCase();
  return DISNAT_BASE_TICKER_ALIASES[s] ?? s;
}

/** Tige en tirets pour Yahoo / Stooq (ex. `BBD-B`) et clé d’agrégation (`BBD.B` ≡ `BBD-B`). */
function canonicalStemHyphenated(stem: string): string {
  return canonicalDisnatStemForQuotes(stem).replace(/\./g, "-");
}

function yahooSymbolForCanadianStem(stemWithoutSuffix: string): string {
  const stem = canonicalStemHyphenated(stemWithoutSuffix);
  return DISNAT_CAD_SPECIAL_YAHOO_SYMBOL[stem] ?? `${stem}.TO`;
}

/**
 * Tige stable pour fusionner des lignes Disnat qui parlent du **même** titre sous des libellés différents
 * (ex. achat `AMZN-U` devise US vs transfert `AMZN` devise CAN dans un compte en dollars canadiens).
 * Utilisée uniquement pour la clé d’agrégation des positions, pas pour l’affichage brut.
 */
export function extractDisnatStemForPositionAggregation(ticker: string): string {
  const std = standardizeDisnatTickerMarketDots(ticker.trim().toUpperCase());
  let raw = std.replace(/\.TO$/i, "").replace(/\./g, "-");
  raw = stripDisnatListingDenominationHyphens(raw);
  return canonicalStemHyphenated(raw);
}

/**
 * Ticker utilisé pour **agrégation** (projection, import positions) : suffixe -C / -U + fusion des alias legacy
 * pour ne pas splitter une ligne à cause d’un seul vieux libellé Disnat (ex. BDRBD ↔ BBD.B-C).
 * L’historique brut peut encore afficher l’ancien code ; la clé courante suit la série (ex. `BBD.B-C`).
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

  /* Clé portefeuille : sans `.TO` (cf. `disnatTickerToYahooSymbol` pour Yahoo).
   * Sinon `BBD.C.TO` + CAD → `BBD-C.TO-C` au lieu de fusionner avec `BBD-C`. */
  const raw = standardizeDisnatTickerMarketDots(ticker.trim())
    .toUpperCase()
    .replace(/\.TO$/i, "");
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
  const raw = standardizeDisnatTickerMarketDots(ticker.trim()).toUpperCase();
  const cc = currency.trim().toUpperCase();
  const hyphen = raw.replace(/\./g, "-");

  if (raw.includes(".TO") || hyphen.endsWith(".TO")) {
    const compact = raw.replace(/\s/g, "");
    const stem = compact.replace(/\.TO$/i, "");
    return `${canonicalStemHyphenated(stripDisnatListingDenominationHyphens(stem.replace(/\./g, "-")))}.TO`;
  }
  if (hyphen.endsWith("-T")) {
    return `${canonicalStemHyphenated(hyphen.replace(/-T$/, ""))}.TO`;
  }
  if (hyphen.endsWith("-C")) {
    return yahooSymbolForCanadianStem(
      stripTrailingCanadianDenominationHyphens(hyphen),
    );
  }
  if (hyphen.endsWith("-U")) {
    return canonicalStemHyphenated(hyphen.replace(/-U$/, ""));
  }
  if (cc === "USD") {
    return canonicalStemHyphenated(hyphen);
  }
  if (cc === "CAD" && !raw.includes(".") && /^[A-Z0-9-]+$/.test(hyphen)) {
    return yahooSymbolForCanadianStem(hyphen);
  }

  return canonicalStemHyphenated(hyphen);
}
