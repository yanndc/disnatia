import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";

export type OwnerShare = {
  owner: string;
  sharePct: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Résout les parts de propriété depuis metadata.ownerShares.
 * Fallback: propriétaire principal à 100%.
 */
export function resolveNonFinancialAssetOwnerShares(
  owner: string | null | undefined,
  metadata: unknown,
): OwnerShare[] {
  const rec = asRecord(metadata);
  const raw = rec?.ownerShares;

  if (Array.isArray(raw)) {
    const shares = raw
      .map((item) => {
        const r = asRecord(item);
        if (!r) return null;
        const cleanedOwner = sanitizePortfolioOwner(
          typeof r.owner === "string" ? r.owner : null,
        );
        const sharePct = Number(r.sharePct);
        if (!cleanedOwner) return null;
        if (!Number.isFinite(sharePct) || sharePct <= 0) return null;
        return { owner: cleanedOwner, sharePct };
      })
      .filter((x): x is OwnerShare => x !== null);

    const sum = shares.reduce((s, x) => s + x.sharePct, 0);
    if (shares.length > 0 && sum > 0) {
      // Normalise pour éviter les petits écarts de saisie (ex. 49.999 + 50.001).
      return shares.map((x) => ({
        owner: x.owner,
        sharePct: (x.sharePct / sum) * 100,
      }));
    }
  }

  const fallbackOwner = sanitizePortfolioOwner(owner);
  return fallbackOwner ? [{ owner: fallbackOwner, sharePct: 100 }] : [];
}
