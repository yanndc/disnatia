/**
 * Attribution d'un fichier Disnat à un compte.
 *
 * Les exports « Historique des transactions » ne contiennent **aucune** colonne compte :
 * l'attribution ne peut donc venir que de signaux externes. On les combine ici, du plus
 * fiable au plus faible :
 *
 * 1. numéro de compte présent (lignes du fichier ou nom de fichier) ;
 * 2. règle mémorisée lors d'une session précédente (signature du fichier) ;
 * 3. type de compte / propriétaire cités dans le nom de fichier (`CELI`, `REER`, `YANN`…) ;
 * 4. recouvrement de contenu : titres du fichier vs avoirs projetés du compte, en
 *    surpondérant les titres détenus par un seul compte ;
 * 5. devise du compte vs devises vues dans le fichier.
 *
 * Le résultat est **toujours** soumis à confirmation humaine : en cas d'égalité, la
 * confiance tombe à `AMBIGUE` et l'UI doit demander le choix.
 */

export type AttributionHolding = {
  ticker: string;
  currency?: string | null;
  quantity?: number | null;
};

export type AttributionAccount = {
  accountKey: string;
  label: string;
  accountName?: string | null;
  accountNumber?: string | null;
  accountType?: string | null;
  owner?: string | null;
  currency: string;
  holdings?: AttributionHolding[];
};

export type AttributionFileFacts = {
  fileName: string;
  /** Numéros de compte lus dans le fichier (exports portefeuille / positions). */
  accountNumbers?: string[];
  /** Titres cités par le fichier (transactions ou positions). */
  tickers?: AttributionHolding[];
  /** Devises vues dans le fichier. */
  currencies?: string[];
  /** En-têtes du fichier (stabilise la signature d'attribution). */
  headers?: string[];
};

export type AttributionConfidence = "EXACTE" | "PROBABLE" | "AMBIGUE" | "AUCUNE";

export type AttributionSuggestion = {
  accountKey: string;
  score: number;
  confidence: AttributionConfidence;
  reasons: string[];
};

/** Seuils de décision (exportés pour les tests et l'UI). */
export const ATTRIBUTION_MIN_SCORE = 40;
export const ATTRIBUTION_EXACT_SCORE = 600;
export const ATTRIBUTION_CLEAR_GAP = 60;

const ACCOUNT_TYPE_TOKENS = [
  "CELIAPP",
  "CELI",
  "REER",
  "REEE",
  "RESP",
  "CRI",
  "FRR",
  "REERPLUS",
  "NONENREGISTRE",
  "COMPTANT",
  "MARGINAL",
  "ENREGISTRE",
];

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function squash(value: string): string {
  return stripDiacritics(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Jetons significatifs d'un nom (propriétaire, libellé de compte). */
function nameTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return stripDiacritics(value)
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= 4);
}

export function accountTypeTokens(value: string | null | undefined): string[] {
  const squashed = squash(value ?? "");
  if (!squashed) return [];
  return ACCOUNT_TYPE_TOKENS.filter((token) => squashed.includes(token));
}

function normalizeTicker(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-[A-Z]{1,2}$/, "");
}

/**
 * Signature stable d'un fichier pour mémoriser l'attribution.
 * Le nom est normalisé (chiffres et suffixes de téléchargement neutralisés) et complété
 * par les premiers en-têtes : deux exports du même compte produisent la même signature.
 */
export function fileAttributionSignature(
  fileName: string,
  headers: string[] = [],
): string {
  const base = stripDiacritics(fileName)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/\(\d+\)/g, "")
    .replace(/\d+/g, "#")
    .replace(/[^a-z0-9#]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const headerKey = headers
    .slice(0, 6)
    .map((h) => stripDiacritics(h).toLowerCase().replace(/[^a-z0-9]+/g, ""))
    .filter(Boolean)
    .join(",");

  return headerKey ? `${base}|${headerKey}` : base;
}

function fileNameText(fileName: string): string {
  return stripDiacritics(fileName).toUpperCase().replace(/[^A-Z0-9]/g, " ");
}

export function suggestAccountAttribution(
  facts: AttributionFileFacts,
  accounts: AttributionAccount[],
  options: {
    /** Règle mémorisée pour la signature du fichier. */
    rememberedAccountKey?: string | null;
  } = {},
): AttributionSuggestion[] {
  const fileTickers = new Set(
    (facts.tickers ?? []).map((t) => normalizeTicker(t.ticker)).filter(Boolean),
  );
  const fileCurrencies = new Set(
    [...(facts.currencies ?? []), ...(facts.tickers ?? []).map((t) => t.currency ?? "")]
      .map((c) => (c ?? "").toUpperCase())
      .filter((c) => c.length === 3),
  );
  const fileAccountNumbers = new Set(
    (facts.accountNumbers ?? []).map((n) => squash(n)).filter(Boolean),
  );
  const nameSquashed = squash(facts.fileName);
  const nameText = fileNameText(facts.fileName);

  /** Titre → nombre de comptes qui le détiennent (bonus aux titres discriminants). */
  const tickerOwners = new Map<string, number>();
  for (const account of accounts) {
    const seen = new Set(
      (account.holdings ?? []).map((h) => normalizeTicker(h.ticker)).filter(Boolean),
    );
    for (const ticker of seen) {
      tickerOwners.set(ticker, (tickerOwners.get(ticker) ?? 0) + 1);
    }
  }

  const fileTypes = new Set(
    [...accountTypeTokens(nameText), ...accountTypeTokens(facts.fileName)].map((t) =>
      t.toUpperCase(),
    ),
  );

  const suggestions: AttributionSuggestion[] = accounts.map((account) => {
    const reasons: string[] = [];
    let score = 0;

    const accountNumber = squash(account.accountNumber ?? "");
    if (accountNumber && fileAccountNumbers.has(accountNumber)) {
      score += 1000;
      reasons.push("numéro de compte présent dans le fichier");
    } else if (accountNumber && nameSquashed.includes(accountNumber)) {
      score += 600;
      reasons.push("numéro de compte dans le nom du fichier");
    }

    if (options.rememberedAccountKey === account.accountKey) {
      score += 400;
      reasons.push("attribution mémorisée pour ce fichier");
    }

    const accountTypes = new Set(
      [
        ...accountTypeTokens(account.accountType ?? ""),
        ...accountTypeTokens(account.label),
      ].map((t) => t.toUpperCase()),
    );
    if (fileTypes.size > 0) {
      const matched = [...fileTypes].filter((t) => accountTypes.has(t));
      if (matched.length > 0) {
        score += 150;
        reasons.push(`type de compte « ${matched[0]} » dans le nom du fichier`);
      } else {
        score -= 60;
      }
    }

    const ownerTokens = nameTokens(account.owner);
    const ownerHits = ownerTokens.filter((token) => nameText.includes(token));
    if (ownerHits.length > 0) {
      score += Math.min(ownerHits.length, 2) * 120;
      reasons.push(`propriétaire « ${ownerHits[0]} » dans le nom du fichier`);
    }

    let overlap = 0;
    let exclusiveOverlap = 0;
    for (const holding of account.holdings ?? []) {
      const ticker = normalizeTicker(holding.ticker);
      if (!ticker || !fileTickers.has(ticker)) continue;
      overlap += 1;
      if ((tickerOwners.get(ticker) ?? 0) === 1) exclusiveOverlap += 1;
    }
    if (overlap > 0) {
      // Un titre détenu par un seul compte est le signal de contenu le plus discriminant.
      score += overlap * 15 + exclusiveOverlap * 60;
      reasons.push(
        exclusiveOverlap > 0
          ? `${overlap} titre(s) en commun dont ${exclusiveOverlap} exclusif(s) à ce compte`
          : `${overlap} titre(s) en commun avec ce compte`,
      );
    }

    if (fileCurrencies.size > 0) {
      if (fileCurrencies.has(account.currency.toUpperCase())) {
        score += 30;
        reasons.push(`devise ${account.currency.toUpperCase()} concordante`);
      } else {
        score -= 40;
      }
    }

    return {
      accountKey: account.accountKey,
      score: Math.max(0, Math.round(score)),
      confidence: "AUCUNE" as AttributionConfidence,
      reasons,
    };
  });

  suggestions.sort((a, b) => b.score - a.score);
  const top = suggestions[0];
  const second = suggestions[1];

  if (!top) return suggestions;

  if (top.score < ATTRIBUTION_MIN_SCORE) {
    top.confidence = "AUCUNE";
    return suggestions;
  }

  const gap = top.score - (second?.score ?? 0);
  top.confidence =
    top.score >= ATTRIBUTION_EXACT_SCORE
      ? "EXACTE"
      : gap >= ATTRIBUTION_CLEAR_GAP
        ? "PROBABLE"
        : "AMBIGUE";

  if (second && gap < ATTRIBUTION_CLEAR_GAP && top.score < ATTRIBUTION_EXACT_SCORE) {
    second.confidence = "AMBIGUE";
  }

  return suggestions;
}

/** Meilleure proposition, ou `null` si aucun signal exploitable. */
export function bestAttributionSuggestion(
  suggestions: AttributionSuggestion[],
): AttributionSuggestion | null {
  const top = suggestions[0];
  if (!top || top.confidence === "AUCUNE") return null;
  return top;
}

/**
 * Déduit les signaux d'attribution d'un snapshot Disnat déjà parsé côté client
 * (`buildPortfolioSnapshot`), sans relire le fichier.
 */
export function attributionFactsFromSnapshot(
  fileName: string,
  snapshot: {
    positions: { ticker: string; currency?: string; accountNumber?: string }[];
    transactions: { ticker?: string; currency?: string; accountNumber?: string }[];
  },
  headers: string[] = [],
): AttributionFileFacts {
  const accountNumbers = new Set<string>();
  const tickers: AttributionHolding[] = [];
  const currencies = new Set<string>();

  for (const position of snapshot.positions) {
    if (position.accountNumber) accountNumbers.add(position.accountNumber);
    if (position.ticker) {
      tickers.push({ ticker: position.ticker, currency: position.currency ?? null });
    }
    if (position.currency) currencies.add(position.currency);
  }
  for (const transaction of snapshot.transactions) {
    if (transaction.accountNumber) accountNumbers.add(transaction.accountNumber);
    if (transaction.ticker) {
      tickers.push({ ticker: transaction.ticker, currency: transaction.currency ?? null });
    }
    if (transaction.currency) currencies.add(transaction.currency);
  }

  return {
    fileName,
    accountNumbers: [...accountNumbers],
    tickers,
    currencies: [...currencies],
    headers,
  };
}
