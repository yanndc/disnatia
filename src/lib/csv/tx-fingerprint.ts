import { createHash } from "crypto";

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
export function txFingerprint(
  accountKey: string,
  tx: {
    tradeDate?: Date | null;
    settlementDate?: Date | null;
    transactionType?: string | null;
    ticker?: string | null;
    amount?: number | null;
    currency?: string | null;
    quantity?: number | null;
    price?: number | null;
    securityName?: string | null;
  },
): string {
  const parts = [
    accountKey,
    tx.tradeDate?.toISOString().slice(0, 10) ?? "",
    tx.settlementDate?.toISOString().slice(0, 10) ?? "",
    (tx.transactionType ?? "").toLowerCase().trim(),
    (tx.ticker ?? "").toUpperCase().trim(),
    tx.amount !== null && tx.amount !== undefined ? String(Math.round(tx.amount * 100)) : "",
    (tx.currency ?? "").toUpperCase(),
    tx.quantity !== null && tx.quantity !== undefined ? String(tx.quantity) : "",
    tx.price !== null && tx.price !== undefined ? String(Math.round(tx.price * 10000)) : "",
    (tx.securityName ?? "").trim().slice(0, 60),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}
