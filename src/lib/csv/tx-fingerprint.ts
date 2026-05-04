import { createHash } from "crypto";

/**
 * Fingerprint basé sur le contenu de la transaction uniquement (sans accountKey).
 * Cela garantit qu'un même fichier ne peut pas être importé deux fois,
 * même s'il est associé à des comptes différents.
 */
export function txFingerprint(
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
    tx.tradeDate?.toISOString().slice(0, 10) ?? "",
    tx.settlementDate?.toISOString().slice(0, 10) ?? "",
    (tx.transactionType ?? "").toLowerCase().trim(),
    (tx.ticker ?? "").toUpperCase().trim(),
    tx.amount !== null && tx.amount !== undefined ? String(Math.round(tx.amount * 100)) : "",
    (tx.currency ?? "").toUpperCase(),
    tx.quantity !== null && tx.quantity !== undefined ? String(tx.quantity) : "",
    tx.price !== null && tx.price !== undefined ? String(Math.round(tx.price * 10000)) : "",
    // securityName inclus pour différencier les transactions sans ticker (dividendes, frais, etc.)
    (tx.securityName ?? "").trim().slice(0, 60),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}
