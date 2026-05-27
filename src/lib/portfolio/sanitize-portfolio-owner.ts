/**
 * Libellés Disnat de section (titres par devise) — pas des propriétaires.
 */
const DISNAT_SECTION_OWNER_PATTERN =
  /^(ACTIONS|OPÉRATIONS|OPERATIONS)\s+(CAD|USD)\s*$/i;

/** Particules conservées en minuscules dans un nom propre (fr-CA). */
const LOWER_PARTICLES = new Set([
  "de",
  "du",
  "des",
  "d",
  "la",
  "le",
  "les",
  "l",
  "et",
]);

function collapseWhitespace(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function capitalizeWord(word: string): string {
  const lower = word.toLocaleLowerCase("fr-CA");
  if (lower.includes("-")) {
    return lower
      .split("-")
      .map((part) =>
        part.length > 0
          ? part.charAt(0).toLocaleUpperCase("fr-CA") + part.slice(1)
          : part,
      )
      .join("-");
  }
  if (lower.length === 0) return lower;
  return lower.charAt(0).toLocaleUpperCase("fr-CA") + lower.slice(1);
}

/**
 * Forme d'affichage canonique : « YANN DE CHAMPLAIN » → « Yann de Champlain ».
 */
export function formatPortfolioOwnerDisplay(raw: string): string {
  const s = collapseWhitespace(raw);
  if (!s) return s;
  return s
    .split(" ")
    .map((word, index) => {
      const lower = word.toLocaleLowerCase("fr-CA");
      if (index > 0 && LOWER_PARTICLES.has(lower)) return lower;
      return capitalizeWord(word);
    })
    .join(" ");
}

/**
 * Retourne null si la valeur ressemble à un en-tête de fichier (« ACTIONS CAD ») et non à une personne.
 * Sinon, renvoie la forme d'affichage canonique.
 */
export function sanitizePortfolioOwner(raw: string | null | undefined): string | null {
  const s = collapseWhitespace(raw ?? "");
  if (!s) return null;
  if (DISNAT_SECTION_OWNER_PATTERN.test(s)) return null;
  return formatPortfolioOwnerDisplay(s);
}

/** Clé de regroupement insensible à la casse / aux variantes Disnat vs saisie manuelle. */
export function portfolioOwnerKey(raw: string | null | undefined): string | null {
  const display = sanitizePortfolioOwner(raw);
  return display ? display.toLocaleLowerCase("fr-CA") : null;
}

export function portfolioOwnersMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = portfolioOwnerKey(a);
  const kb = portfolioOwnerKey(b);
  if (!ka || !kb) return ka === kb;
  return ka === kb;
}

/** Liste dédupliquée de propriétaires pour les filtres UI. */
export function uniquePortfolioOwners(
  rawOwners: (string | null | undefined)[],
): string[] {
  const byKey = new Map<string, string>();
  for (const raw of rawOwners) {
    const display = sanitizePortfolioOwner(raw);
    const key = portfolioOwnerKey(raw);
    if (!display || !key) continue;
    if (!byKey.has(key)) byKey.set(key, display);
  }
  return [...byKey.values()].toSorted((a, b) => a.localeCompare(b, "fr-CA"));
}
