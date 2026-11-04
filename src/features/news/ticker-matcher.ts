import type { NewsPortfolioTicker } from "./news-portfolio";

export type TickerMatchKind = "TICKER" | "NAME" | "ALIAS";

export type TickerMatch = {
  ticker: string;
  displayTicker: string;
  yahooSymbol: string;
  matchKind: TickerMatchKind;
  confidence: number;
  exposurePct: number;
  valueCad: number;
};

export type TickerIndexEntry = NewsPortfolioTicker & {
  aliases: string[];
  /** Jetons distinctifs du nom de société (déjà filtrés des mots génériques). */
  nameTokens: string[];
};

/**
 * Alias éditoriaux : les articles utilisent le nom courant, pas la raison sociale Disnat.
 * Clé = tige d'agrégation (majuscules, tirets).
 */
const TICKER_ALIASES: Record<string, string[]> = {
  RY: ["Banque Royale", "Royal Bank", "RBC"],
  TD: ["Toronto-Dominion", "TD Bank", "Banque TD"],
  BNS: ["Banque Scotia", "Scotiabank", "Bank of Nova Scotia"],
  BMO: ["Banque de Montréal", "Bank of Montreal", "BMO Financial"],
  CM: ["Banque CIBC", "CIBC", "Canadian Imperial"],
  NA: ["Banque Nationale", "National Bank of Canada"],
  BCE: ["Bell Canada", "Bell Canada Enterprises", "BCE Inc"],
  T: ["TELUS", "Telus Corporation"],
  RCI: ["Rogers Communications", "Rogers"],
  QBR: ["Québecor", "Quebecor"],
  SU: ["Suncor", "Suncor Energy"],
  CNQ: ["Canadian Natural Resources"],
  IMO: ["Imperial Oil", "Impériale"],
  CVE: ["Cenovus"],
  ENB: ["Enbridge", "Enbridge Pipelines"],
  TRP: ["TC Energy", "TransCanada"],
  PPL: ["Pembina Pipeline"],
  CNR: ["Canadien National", "Canadian National", "CN Rail"],
  CP: ["Canadien Pacifique", "Canadian Pacific", "CPKC"],
  MFC: ["Manuvie", "Manulife"],
  SLF: ["Sun Life", "Financière Sun Life"],
  GWO: ["Great-West", "Great West Lifeco", "Power Corporation"],
  POW: ["Power Corporation", "Power Corp"],
  ATD: ["Couche-Tard", "Alimentation Couche-Tard"],
  SHOP: ["Shopify"],
  CSU: ["Constellation Software"],
  WCN: ["Waste Connections"],
  MG: ["Magna International", "Magna"],
  ABX: ["Barrick Gold", "Barrick"],
  AEM: ["Agnico Eagle", "Agnico"],
  K: ["Kinross"],
  L: ["Loblaw", "Provigo", "Maxi"],
  MRU: ["Metro Inc", "Metro Richelieu"],
  EMP: ["Empire Company", "Sobeys", "IGA"],
  SAP: ["Saputo"],
  CAE: ["CAE Inc"],
  TRI: ["Thomson Reuters"],
  OTEX: ["Open Text", "OpenText"],
  BB: ["BlackBerry", "Research In Motion"],
  AC: ["Air Canada"],
  XEG: ["iShares S&P/TSX Capped Energy"],
  XEI: ["iShares S&P/TSX Composite High Dividend"],
  ZEB: ["BMO S&P/TSX Equal Weight Banks"],
  VFV: ["Vanguard S&P 500"],
  VOO: ["Vanguard S&P 500"],
  SPY: ["SPDR S&P 500"],
  AAPL: ["Apple"],
  MSFT: ["Microsoft"],
  GOOGL: ["Google", "Alphabet"],
  AMZN: ["Amazon"],
  NVDA: ["Nvidia", "NVIDIA"],
  META: ["Meta Platforms", "Facebook"],
  TSLA: ["Tesla"],
};

/** Mots génériques ignorés dans les noms de sociétés (évitent les faux positifs). */
const GENERIC_NAME_TOKENS = new Set([
  "INC", "INCORPORATED", "LTD", "LIMITED", "LTEE", "CORP", "CORPORATION", "COMPANY",
  "COMPAGNIE", "GROUP", "GROUPE", "HOLDINGS", "HOLDING", "TRUST", "FUND", "FONDS",
  "ETF", "INDEX", "INDICE", "CLASS", "SERIES", "SERIE", "THE", "AND", "ET", "DE",
  "DU", "DES", "LA", "LE", "LES", "COMMON", "SHARES", "ACTIONS", "ORDINARY",
  "REGISTERED", "CAPITAL", "BANK", "BANQUE", "NEW", "CAPPED", "COMPOSITE",
  // Marques d'émetteurs d'ETF et mots de gabarit : sources de faux positifs
  // (« SPDR Portfolio S&P 500 Growth » ≠ SPY).
  "SPDR", "ISHARES", "VANGUARD", "INVESCO", "XTRACKERS", "POWERSHARES", "HARVEST",
  "GLOBAL", "PORTFOLIO", "GROWTH", "VALUE", "DIVIDEND", "CORE", "TOTAL", "MARKET",
  "EQUITY", "BONDS", "HIGH", "LOW", "HEDGED", "MONTHLY", "INCOME", "CANADIAN",
  "AMERICAN", "INTERNATIONAL", "EMERGING", "TSX", "500", "1000", "2000", "60",
]);

/** Tickers trop courts/ambigus : exigent une occurrence en majuscules dans le texte. */
const AMBIGUOUS_SHORT_TICKERS = new Set([
  "T", "K", "L", "X", "V", "C", "F", "O", "Q", "W", "A", "B", "M", "S", "R", "P",
]);

/** Mots anglais courants qui sont aussi des tickers : jamais reconnus en minuscules. */
const WORD_LIKE_TICKERS = new Set([
  "ALL", "KEY", "ONE", "NOW", "NEW", "BEST", "GOOD", "SURE", "OPEN", "FAST", "POT",
  "CAR", "REAL", "MAIN", "PLAY", "PLAN", "GAME", "HOME", "LIFE", "TIME", "TRUE",
  "UNIT", "CASH", "GOLD", "OIL", "GAS", "ON", "IT", "AT", "IN", "OR", "SO", "WE",
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Vrai si `token` apparaît comme mot entier (insensible à la casse). */
export function containsWord(text: string, token: string): boolean {
  if (!text || !token) return false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(token)}([^\\p{L}\\p{N}]|$)`, "iu");
  return re.test(text);
}

/** Vrai si `token` apparaît en majuscules (détection de ticker « volontaire »). */
function containsUppercaseWord(text: string, token: string): boolean {
  const re = new RegExp(
    `(^|[^A-Za-z0-9])${escapeRegex(token.toUpperCase())}([^A-Za-z0-9]|$)`,
  );
  return re.test(text);
}

function splitNameTokens(securityName: string | null): string[] {
  if (!securityName) return [];
  return [
    ...new Set(
      securityName
        .toUpperCase()
        .replace(/[^A-Z0-9 ]+/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !GENERIC_NAME_TOKENS.has(token)),
    ),
  ];
}

/** Prépare l'index de recherche à partir des titres détenus. */
export function buildTickerIndex(tickers: NewsPortfolioTicker[]): TickerIndexEntry[] {
  return tickers.map((ticker) => ({
    ...ticker,
    aliases: TICKER_ALIASES[ticker.stem.toUpperCase()] ?? [],
    nameTokens: splitNameTokens(ticker.securityName),
  }));
}

function tickerVariants(entry: TickerIndexEntry): string[] {
  const stem = entry.stem.toUpperCase();
  const variants = new Set<string>([stem, stem.replace(/-/g, "."), stem.replace(/-/g, "")]);
  const core = stem.split("-")[0];
  if (core && core.length >= 4) variants.add(core);
  return [...variants].filter((v) => v.length >= 2);
}

function toMatch(entry: TickerIndexEntry, matchKind: TickerMatchKind, confidence: number): TickerMatch {
  return {
    ticker: entry.ticker,
    displayTicker: entry.displayTicker,
    yahooSymbol: entry.yahooSymbol,
    matchKind,
    confidence: Math.round(confidence * 100) / 100,
    exposurePct: entry.exposurePct,
    valueCad: entry.valueCad,
  };
}

/** Meilleur score de correspondance entre un article et un titre détenu. */
function matchEntry(text: string, entry: TickerIndexEntry): TickerMatch | null {
  let best: TickerMatch | null = null;

  for (const variant of tickerVariants(entry)) {
    const upper = variant.toUpperCase();
    if (containsUppercaseWord(text, upper)) {
      const confidence = upper.length <= 2 || AMBIGUOUS_SHORT_TICKERS.has(upper) ? 0.9 : 1;
      const candidate = toMatch(entry, "TICKER", confidence);
      if (!best || candidate.confidence > best.confidence) best = candidate;
      continue;
    }
    if (upper.length < 3 || WORD_LIKE_TICKERS.has(upper)) continue;
    if (containsWord(text, variant)) {
      const candidate = toMatch(entry, "TICKER", 0.8);
      if (!best || candidate.confidence > best.confidence) best = candidate;
    }
  }

  for (const alias of entry.aliases) {
    if (alias.length < 4) continue;
    if (containsWord(text, alias)) {
      const candidate = toMatch(entry, "ALIAS", 0.85);
      if (!best || candidate.confidence > best.confidence) best = candidate;
    }
  }

  if (entry.nameTokens.length > 0) {
    const matched = entry.nameTokens.filter((token) => containsWord(text, token));
    const longSingle = matched.some((token) => token.length >= 8);
    if (matched.length >= 2 || (matched.length === 1 && longSingle)) {
      const ratio = matched.length / entry.nameTokens.length;
      const candidate = toMatch(entry, "NAME", Math.min(0.9, 0.7 + ratio * 0.2));
      if (!best || candidate.confidence > best.confidence) best = candidate;
    }
  }

  return best;
}

export type TickerMatchInput = {
  title: string;
  excerpt?: string | null;
  publisher?: string | null;
};

/**
 * Titres détenus cités par un article. Le texte de recherche combine titre, résumé et éditeur ;
 * on ne garde que le meilleur match par titre et on trie par confiance puis exposition.
 */
export function matchTickersInEntry(
  input: TickerMatchInput,
  index: TickerIndexEntry[],
  options: { maxMatches?: number } = {},
): TickerMatch[] {
  if (index.length === 0) return [];
  const haystack = [input.title, input.excerpt ?? "", input.publisher ?? ""]
    .filter(Boolean)
    .join(" \n ");
  if (!haystack.trim()) return [];

  const byTicker = new Map<string, TickerMatch>();
  for (const entry of index) {
    const match = matchEntry(haystack, entry);
    if (!match) continue;
    const existing = byTicker.get(match.ticker);
    if (!existing || match.confidence > existing.confidence) {
      byTicker.set(match.ticker, match);
    }
  }

  return [...byTicker.values()]
    .sort((a, b) => b.confidence - a.confidence || b.valueCad - a.valueCad)
    .slice(0, options.maxMatches ?? 6);
}
