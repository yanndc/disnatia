import type { NewsCategory, NewsSourceKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

export type SeedNewsSource = {
  slug: string;
  name: string;
  feedUrl: string;
  homepageUrl?: string;
  kind: NewsSourceKind;
  language: string;
  category: NewsCategory;
  weight: number;
};

/** Flux construit à la volée à partir des titres détenus (gabarit `{symbol}` = symbole Yahoo). */
export const AUTO_TICKER_SOURCE_SLUG = "yahoo-par-titre";
export const AUTO_TICKER_FEED_TEMPLATE =
  "https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=CA&lang=en-CA";

/** Nombre de positions (les plus lourdes) suivies individuellement par le flux auto. */
export const AUTO_TICKER_MAX_SYMBOLS = 12;

/**
 * Registre de départ. L'admin (`/imports?tab=news`) peut ensuite désactiver,
 * repondérer ou supprimer un flux : le seed ne réécrit jamais ces choix.
 */
export const SEED_NEWS_SOURCES: SeedNewsSource[] = [
  {
    slug: "google-actualites-affaires",
    name: "Google Actualités · Affaires (QC)",
    feedUrl:
      "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=fr-CA&gl=CA&ceid=CA:fr",
    homepageUrl: "https://news.google.com/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtWnZHZ0pEUVNvQ0FBUAE?hl=fr-CA&gl=CA&ceid=CA:fr",
    kind: "RSS",
    language: "fr",
    category: "MARKETS",
    weight: 1.1,
  },
  {
    slug: "les-affaires",
    name: "Les Affaires (via Google Actualités)",
    feedUrl:
      "https://news.google.com/rss/search?q=site%3Alesaffaires.com&hl=fr-CA&gl=CA&ceid=CA:fr",
    homepageUrl: "https://www.lesaffaires.com",
    kind: "RSS",
    language: "fr",
    category: "MARKETS",
    weight: 1.3,
  },
  {
    slug: "la-presse-affaires",
    name: "La Presse · Affaires",
    feedUrl: "https://www.lapresse.ca/affaires/rss",
    homepageUrl: "https://www.lapresse.ca/affaires",
    kind: "RSS",
    language: "fr",
    category: "MARKETS",
    weight: 1.1,
  },
  {
    slug: "le-devoir",
    name: "Le Devoir",
    feedUrl: "https://www.ledevoir.com/rss/manchettes.xml",
    homepageUrl: "https://www.ledevoir.com",
    kind: "RSS",
    language: "fr",
    category: "ECONOMY",
    weight: 1,
  },
  {
    slug: "globe-and-mail-business",
    name: "The Globe and Mail · Business",
    feedUrl:
      "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/business/?outputType=xml",
    homepageUrl: "https://www.theglobeandmail.com/business",
    kind: "RSS",
    language: "en",
    category: "MARKETS",
    weight: 1,
  },
  {
    slug: "banque-du-canada",
    name: "Banque du Canada · Communiqués",
    feedUrl: "https://www.bankofcanada.ca/content_type/press-releases/feed/",
    homepageUrl: "https://www.banque-du-canada.ca",
    kind: "RSS",
    language: "en",
    category: "ECONOMY",
    weight: 1.2,
  },
  {
    slug: AUTO_TICKER_SOURCE_SLUG,
    name: "Yahoo Finance · Par titre détenu",
    feedUrl: AUTO_TICKER_FEED_TEMPLATE,
    homepageUrl: "https://finance.yahoo.com",
    kind: "AUTO_TICKER",
    language: "en",
    category: "COMPANY",
    weight: 1.2,
  },
];

/**
 * Crée les flux manquants. Un flux existant n'est **pas** réactivé ni repondéré
 * (l'utilisateur peut l'avoir désactivé volontairement) : on rafraîchit seulement le libellé.
 */
export async function ensureNewsSourcesSeeded(): Promise<void> {
  for (const seed of SEED_NEWS_SOURCES) {
    await prisma.newsSource.upsert({
      where: { slug: seed.slug },
      create: {
        slug: seed.slug,
        name: seed.name,
        feedUrl: seed.feedUrl,
        homepageUrl: seed.homepageUrl ?? null,
        kind: seed.kind,
        language: seed.language,
        category: seed.category,
        weight: seed.weight,
        isSeed: true,
      },
      update: {
        name: seed.name,
        homepageUrl: seed.homepageUrl ?? null,
        isSeed: true,
      },
    });
  }
}

/** Construit l'URL du flux Yahoo pour un symbole (ex. `RY.TO`). */
export function autoTickerFeedUrl(symbol: string): string {
  return AUTO_TICKER_FEED_TEMPLATE.replace("{symbol}", encodeURIComponent(symbol));
}
