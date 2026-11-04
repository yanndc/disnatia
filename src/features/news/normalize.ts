import { createHash } from "node:crypto";
import type { NewsCategory } from "@/generated/prisma/client";

/** Paramètres de tracking retirés des URLs avant déduplication. */
const TRACKING_QUERY_KEYS = new Set([
  "fbclid",
  "gclid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
  "source",
  "campaign",
  "cmpid",
  "s_cid",
  "smid",
  "ito",
  "at_medium",
  "at_campaign",
  "_ga",
]);

const TRACKING_QUERY_PREFIXES = ["utm_", "pk_", "mtm_", "oc_"];

/**
 * URL canonique : hostname minuscule, pas de fragment, pas de paramètres de tracking,
 * slash final retiré. `null` si l'URL n'est pas http(s).
 */
export function canonicalizeUrl(raw: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  const kept = [...url.searchParams.entries()].filter(([key]) => {
    const k = key.toLowerCase();
    if (TRACKING_QUERY_KEYS.has(k)) return false;
    return !TRACKING_QUERY_PREFIXES.some((prefix) => k.startsWith(prefix));
  });
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);

  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

/** Nom de domaine affichable d'une URL canonique. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Titre sans accent ni ponctuation — base de l'empreinte anti-doublon. */
export function normalizeTitleForFingerprint(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Les agrégateurs (Google Actualités) suffixent « - Les Affaires ».
 * On retire le suffixe quand il correspond à l'éditeur détecté, sinon au dernier segment court.
 */
export function stripPublisherSuffix(title: string, publisher?: string | null): string {
  const cleaned = title.trim();
  if (!cleaned) return cleaned;
  const pub = publisher?.trim();
  if (pub) {
    const escaped = pub.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const withPublisher = cleaned.replace(new RegExp(`\\s*[-–—|]\\s*${escaped}$`, "i"), "");
    if (withPublisher !== cleaned && withPublisher.length >= 12) return withPublisher.trim();
  }
  const generic = cleaned.match(/^(.*\S)\s[-–—|]\s[^-–—|]{2,40}$/);
  if (generic && generic[1].length >= 20) return generic[1].trim();
  return cleaned;
}

/** Empreinte stable : même dépêche republiée sur deux URLs différentes ⇒ même valeur. */
export function titleFingerprint(title: string, canonicalUrl: string): string {
  const host = hostnameOf(canonicalUrl);
  const normalized = normalizeTitleForFingerprint(stripPublisherSuffix(title));
  return createHash("sha1").update(`${normalized}|${host}`).digest("hex");
}

/** Coupe proprement un texte à la longueur maximale, sans casser le dernier mot. */
export function truncateText(text: string, maxLength: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const slice = clean.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/**
 * Résumé court d'un article : description du flux, bornée et nettoyée.
 * Retourne `null` quand le résumé n'apporte rien (identique au titre, lien nu d'agrégateur).
 */
export function buildExcerpt(
  title: string,
  summary: string | null | undefined,
  maxLength = 400,
): string | null {
  const base = (summary ?? "").replace(/\s+/g, " ").trim();
  if (!base) return null;
  const withoutTitle = base.toLowerCase().startsWith(title.toLowerCase())
    ? base.slice(title.length).trim()
    : base;
  const candidate = withoutTitle.length >= 40 ? withoutTitle : base;
  if (candidate.length < 25) return null;
  const normalizedCandidate = normalizeTitleForFingerprint(candidate);
  if (!normalizedCandidate) return null;
  if (normalizedCandidate === normalizeTitleForFingerprint(title)) return null;
  return truncateText(candidate, maxLength);
}


const CATEGORY_KEYWORDS: Record<Exclude<NewsCategory, "OTHER">, string[]> = {
  MARKETS: [
    "bourse", "marché", "marche", "indice", "tsx", "s&p", "nasdaq", "dow", "obligation",
    "rendement", "actions", "cours", "wall street", "volatilité", "volatilite",
    "stock", "market", "index", "shares", "bond", "earnings",
  ],
  COMPANY: [
    "acquisition", "fusion", "rachat", "dividende", "bénéfice", "benefice",
    "chiffre d'affaires", "mise à pied", "p.-d.g.", "pdg", "ceo", "résultats trimestriels",
    "offre publique", "merger", "dividend", "layoffs", "quarterly", "revenue", "guidance",
  ],
  ECONOMY: [
    "banque du canada", "taux directeur", "inflation", "statistique canada", "pib", "chômage",
    "chomage", "récession", "recession", "budget", "ministre des finances", "tarif", "tariff",
    "réserve fédérale", "emploi", "cpi", "gdp", "interest rate", "policy rate",
  ],
  REAL_ESTATE: [
    "immobilier", "hypothèque", "hypotheque", "logement", "mise en chantier", "loyer",
    "construction", "reit", "housing", "mortgage", "real estate", "property",
  ],
  PERSONAL_FINANCE: [
    "reer", "celi", "ftq", "rqap", "retraite", "impôt", "impot", "épargne", "epargne",
    "assurance", "rrsp", "tfsa", "tax", "saving", "retirement",
  ],
};

/** Classe un article par mots-clés (FR + EN), avec la catégorie du flux en repli. */
export function classifyCategory(
  text: string,
  fallback: NewsCategory = "OTHER",
): NewsCategory {
  const haystack = ` ${text.toLowerCase()} `;
  let best: { category: Exclude<NewsCategory, "OTHER">; hits: number } | null = null;
  const entries = Object.entries(CATEGORY_KEYWORDS) as Array<
    [Exclude<NewsCategory, "OTHER">, string[]]
  >;
  for (const [category, keywords] of entries) {
    let hits = 0;
    for (const keyword of keywords) {
      if (haystack.includes(keyword)) hits += 1;
    }
    if (hits > 0 && (!best || hits > best.hits)) best = { category, hits };
  }
  return best ? best.category : fallback;
}

const FRENCH_MARKERS = [" le ", " la ", " les ", " des ", " du ", " pour ", " avec ", " sur ", " est ", " une "];
const ENGLISH_MARKERS = [" the ", " and ", " for ", " with ", " this ", " that ", " from ", " will ", " has "];

/** Détection de langue grossière (fr/en) suffisante pour l'affichage et le tri. */
export function guessLanguage(text: string, fallback = "fr"): string {
  const haystack = ` ${text.toLowerCase()} `;
  const fr = FRENCH_MARKERS.filter((m) => haystack.includes(m)).length;
  const en = ENGLISH_MARKERS.filter((m) => haystack.includes(m)).length;
  if (fr === en) return fallback;
  return fr > en ? "fr" : "en";
}

/**
 * Titres de « bruit de flux » produits automatiquement par les fils par titre
 * (Zacks/Yahoo) : mouvements d'ETF, pré-séance. Aucune valeur pour un portefeuille.
 */
const NOISE_TITLE_PATTERNS: RegExp[] = [
  /\betf activity\b/i,
  /\betf\b[\s\S]*\b(bought|buys|bought|sold|sells)\b/i,
  /\bexchange-traded funds?\b[\s\S]*\b(pre-bell|pre-market|futures)\b/i,
  /\bequity futures\b[\s\S]*\b(pre-bell|pre-market)\b/i,
];

/** Vrai si le titre d'un article est du bruit automatisé de flux financiers. */
export function isNoisyFeedTitle(title: string): boolean {
  return NOISE_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

/** Libellés français des catégories (UI + badges). */
export { NEWS_CATEGORY_LABELS } from "./news-categories";
