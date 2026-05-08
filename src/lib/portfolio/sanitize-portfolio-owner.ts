/**
 * Libellés Disnat de section (titres par devise) — pas des propriétaires.
 */
const DISNAT_SECTION_OWNER_PATTERN =
  /^(ACTIONS|OPÉRATIONS|OPERATIONS)\s+(CAD|USD)\s*$/i;

/**
 * Retourne null si la valeur ressemble à un en-tête de fichier (« ACTIONS CAD ») et non à une personne.
 */
export function sanitizePortfolioOwner(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (DISNAT_SECTION_OWNER_PATTERN.test(s)) return null;
  return s;
}
