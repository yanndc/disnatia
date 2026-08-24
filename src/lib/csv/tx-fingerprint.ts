import { createHash } from "crypto";

/** Même cadre que l’API d’import : identifie deux lignes identiques rattachées à des comptes différents. */
export const GLOBAL_TRANSACTION_DUPLICATE_SCOPE = "__global_transaction_duplicate_scope__";

export type TxFingerprintInput = {
  tradeDate?: Date | null;
  settlementDate?: Date | null;
  transactionType?: string | null;
  ticker?: string | null;
  amount?: number | null;
  currency?: string | null;
  quantity?: number | null;
  price?: number | null;
  securityName?: string | null;
};

/**
 * Normalise un ticker en enlevant les suffixes de devise (-U, -C) pour comparaison.
 * AAPL-U, AAPL-C, et AAPL → tous normalisés à "AAPL" pour éviter les faux-positifs
 * quand Disnat exporte la même transaction avec des représentations différentes.
 */
function normalizeTickerForFingerprint(ticker: string): string {
  const upper = ticker.toUpperCase().trim();
  return upper.replace(/-(U|C)$/, "");
}

/**
 * Vrai pour un ticker "placeholder" (« - », « --C », « --U »…) que Disnat met sur les lignes
 * sans titre réel (dépôt, virement en argent). Ce placeholder varie d'un export "Historique"
 * à l'autre pour le MÊME événement (ex. "-" vs "--C" pour le même dépôt) — l'inclure dans
 * l'empreinte ferait passer deux imports du même dépôt comme des lignes distinctes (doublon
 * non détecté). Un vrai symbole boursier (AAPL, RY, BBD.B…) ne matche jamais ce test, donc un
 * virement EN NATURE de deux titres différents le même jour reste correctement distingué.
 */
function isPlaceholderTicker(ticker: string): boolean {
  const stripped = ticker.replace(/-/g, "");
  return stripped.length <= 1;
}

/**
 * Fingerprint déterministe incluant accountKey.
 *
 * accountKey est inclus pour éviter les faux-positifs entre comptes différents
 * qui peuvent avoir des transactions apparemment identiques (ex. intérêts du
 * même montant le même jour dans deux comptes USD distincts).
 *
 * Pour annuler un import envoyé au mauvais compte : supprimer l'import dans
 * /imports (cascade supprime les transactions + libère les fingerprints), puis
 * réimporter avec le bon compte.
 */
export function txFingerprint(accountKey: string, tx: TxFingerprintInput): string {
  const tickerRaw = (tx.ticker ?? "").toUpperCase().trim();
  const tickerNorm = isPlaceholderTicker(tickerRaw) ? "" : normalizeTickerForFingerprint(tickerRaw);
  const parts = [
    accountKey,
    tx.tradeDate?.toISOString().slice(0, 10) ?? "",
    tx.settlementDate?.toISOString().slice(0, 10) ?? "",
    (tx.transactionType ?? "").toLowerCase().trim(),
    tickerNorm,
    tx.amount !== null && tx.amount !== undefined ? String(Math.round(tx.amount * 100)) : "",
    (tx.currency ?? "").toUpperCase(),
    tx.quantity !== null && tx.quantity !== undefined ? String(tx.quantity) : "",
    tx.price !== null && tx.price !== undefined ? String(Math.round(tx.price * 10000)) : "",
    (tx.securityName ?? "").trim().slice(0, 60),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

export function globalTransactionFingerprint(tx: TxFingerprintInput): string {
  return txFingerprint(GLOBAL_TRANSACTION_DUPLICATE_SCOPE, tx);
}
