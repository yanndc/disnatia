import type { NewsCategory, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

export const NEWS_FEED_PAGE_SIZE = 20;

export type NewsFeedScope = "portfolio" | "all" | "saved";

export type NewsFeedItem = {
  id: string;
  title: string;
  url: string;
  excerpt: string | null;
  publisher: string | null;
  imageUrl: string | null;
  language: string;
  category: NewsCategory;
  publishedAt: string;
  relevanceScore: number;
  portfolioPct: number | null;
  portfolioValueCad: number | null;
  read: boolean;
  saved: boolean;
  source: { slug: string; name: string };
  tickers: { ticker: string; matchKind: string; confidence: number }[];
};

const NEWS_ITEM_SELECT = {
  id: true,
  title: true,
  url: true,
  excerpt: true,
  publisher: true,
  imageUrl: true,
  language: true,
  category: true,
  publishedAt: true,
  relevanceScore: true,
  portfolioPct: true,
  portfolioValueCad: true,
  readAt: true,
  savedAt: true,
  source: { select: { slug: true, name: true } },
  tickers: {
    select: { ticker: true, matchKind: true, confidence: true },
    orderBy: { confidence: "desc" },
  },
} satisfies Prisma.NewsItemSelect;

type NewsItemRow = Prisma.NewsItemGetPayload<{ select: typeof NEWS_ITEM_SELECT }>;

function toFeedItem(row: NewsItemRow): NewsFeedItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    excerpt: row.excerpt,
    publisher: row.publisher,
    imageUrl: row.imageUrl,
    language: row.language,
    category: row.category,
    publishedAt: row.publishedAt.toISOString(),
    relevanceScore: row.relevanceScore,
    portfolioPct: row.portfolioPct,
    portfolioValueCad: row.portfolioValueCad,
    read: row.readAt !== null,
    saved: row.savedAt !== null,
    source: { slug: row.source.slug, name: row.source.name },
    tickers: row.tickers.map((ticker) => ({
      ticker: ticker.ticker,
      matchKind: ticker.matchKind,
      confidence: ticker.confidence,
    })),
  };
}

export type NewsFeedFilter = {
  scope?: NewsFeedScope;
  category?: NewsCategory | null;
  sourceSlug?: string | null;
  query?: string | null;
  limit?: number;
  cursor?: string | null;
};

function encodeCursor(item: { publishedAt: Date; id: string }): string {
  return Buffer.from(`${item.publishedAt.toISOString()}|${item.id}`).toString("base64url");
}

function decodeCursor(cursor: string): { publishedAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!iso || !id) return null;
    const publishedAt = new Date(iso);
    if (Number.isNaN(publishedAt.getTime())) return null;
    return { publishedAt, id };
  } catch {
    return null;
  }
}

function buildFeedWhere(filter: NewsFeedFilter): Prisma.NewsItemWhereInput {
  const where: Prisma.NewsItemWhereInput = {};
  const scope = filter.scope ?? "portfolio";
  if (scope === "portfolio") where.tickers = { some: {} };
  if (scope === "saved") where.savedAt = { not: null };
  if (filter.category) where.category = filter.category;
  if (filter.sourceSlug) where.source = { slug: filter.sourceSlug };

  const query = filter.query?.trim();
  if (query && query.length >= 2) {
    where.OR = [
      { title: { contains: query, mode: "insensitive" } },
      { excerpt: { contains: query, mode: "insensitive" } },
      { publisher: { contains: query, mode: "insensitive" } },
    ];
  }
  return where;
}

export type NewsFeedPage = {
  items: NewsFeedItem[];
  nextCursor: string | null;
  totalMatched: number;
};

/** Fil paginé (curseur `publishedAt` + `id`, stable quand de nouvelles dépêches arrivent). */
export async function getNewsFeed(filter: NewsFeedFilter = {}): Promise<NewsFeedPage> {
  const limit = Math.min(Math.max(filter.limit ?? NEWS_FEED_PAGE_SIZE, 1), 50);
  const baseWhere = buildFeedWhere(filter);
  const cursor = filter.cursor ? decodeCursor(filter.cursor) : null;

  const where: Prisma.NewsItemWhereInput = cursor
    ? {
        AND: [
          baseWhere,
          {
            OR: [
              { publishedAt: { lt: cursor.publishedAt } },
              { publishedAt: cursor.publishedAt, id: { lt: cursor.id } },
            ],
          },
        ],
      }
    : baseWhere;

  const [rows, totalMatched] = await Promise.all([
    prisma.newsItem.findMany({
      where,
      select: NEWS_ITEM_SELECT,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
    prisma.newsItem.count({ where: baseWhere }).catch(() => 0),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toFeedItem),
    nextCursor: hasMore && last ? encodeCursor({ publishedAt: last.publishedAt, id: last.id }) : null,
    totalMatched,
  };
}

/** Nouvelles les plus pertinentes qui touchent réellement une position (widget overview). */
export async function getNewsHighlights(limit = 4): Promise<NewsFeedItem[]> {
  const since = new Date(Date.now() - 96 * 3600 * 1000);
  const rows = await prisma.newsItem
    .findMany({
      where: { publishedAt: { gte: since }, tickers: { some: {} } },
      select: NEWS_ITEM_SELECT,
      orderBy: [{ relevanceScore: "desc" }, { publishedAt: "desc" }],
      take: Math.min(Math.max(limit, 1), 12),
    })
    .catch(() => [] as NewsItemRow[]);
  return rows.map(toFeedItem);
}

export type NewsSourceRow = {
  id: string;
  slug: string;
  name: string;
  feedUrl: string;
  homepageUrl: string | null;
  kind: "RSS" | "AUTO_TICKER";
  language: string;
  category: NewsCategory;
  weight: number;
  isActive: boolean;
  isSeed: boolean;
  lastFetchedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastItemCount: number;
  itemCount7d: number;
  itemCountTotal: number;
};

/** Sources + santé observée (articles des 7 derniers jours, dernier passage, erreur). */
export async function getNewsSourcesWithStats(): Promise<NewsSourceRow[]> {
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [sources, recentCounts, totalCounts] = await Promise.all([
    prisma.newsSource.findMany({ orderBy: [{ isSeed: "desc" }, { name: "asc" }] }),
    prisma.newsItem.groupBy({
      by: ["sourceId"],
      where: { publishedAt: { gte: since7d } },
      _count: { _all: true },
    }),
    prisma.newsItem.groupBy({ by: ["sourceId"], _count: { _all: true } }),
  ]);

  const recentBySource = new Map(recentCounts.map((row) => [row.sourceId, row._count._all]));
  const totalBySource = new Map(totalCounts.map((row) => [row.sourceId, row._count._all]));

  return sources.map((source) => ({
    id: source.id,
    slug: source.slug,
    name: source.name,
    feedUrl: source.feedUrl,
    homepageUrl: source.homepageUrl,
    kind: source.kind,
    language: source.language,
    category: source.category,
    weight: source.weight,
    isActive: source.isActive,
    isSeed: source.isSeed,
    lastFetchedAt: source.lastFetchedAt?.toISOString() ?? null,
    lastStatus: source.lastStatus,
    lastError: source.lastError,
    lastItemCount: source.lastItemCount,
    itemCount7d: recentBySource.get(source.id) ?? 0,
    itemCountTotal: totalBySource.get(source.id) ?? 0,
  }));
}

export type NewsStats = {
  total: number;
  last24h: number;
  portfolioMatched: number;
  saved: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
};

/** Compteurs d'en-tête de la page `/nouvelles`. */
export async function getNewsStats(): Promise<NewsStats> {
  const since24h = new Date(Date.now() - 24 * 3600 * 1000);
  const [total, last24h, portfolioMatched, saved, lastRun] = await Promise.all([
    prisma.newsItem.count().catch(() => 0),
    prisma.newsItem.count({ where: { publishedAt: { gte: since24h } } }).catch(() => 0),
    prisma.newsItem.count({ where: { tickers: { some: {} } } }).catch(() => 0),
    prisma.newsItem.count({ where: { savedAt: { not: null } } }).catch(() => 0),
    prisma.newsIngestionRun
      .findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true } })
      .catch(() => null),
  ]);
  return {
    total,
    last24h,
    portfolioMatched,
    saved,
    lastRunAt: lastRun?.startedAt.toISOString() ?? null,
    lastRunStatus: lastRun?.status ?? null,
  };
}

export type PortfolioNewsDigestRow = {
  title: string;
  url: string;
  publisher: string | null;
  sourceName: string;
  publishedAt: string;
  category: NewsCategory;
  excerpt: string | null;
  portfolioPct: number | null;
  tickers: string[];
};

/**
 * Contexte « actualité » pour Pinocchio : articles ingérés rattachés au portefeuille,
 * filtrés par ancienneté et éventuellement par titre. Aucun appel réseau (données en base).
 */
export async function getPortfolioNewsDigest(opts: {
  sinceHours?: number;
  limit?: number;
  ticker?: string | null;
} = {}): Promise<{ generatedAt: string; items: PortfolioNewsDigestRow[] }> {
  const sinceHours = Math.min(Math.max(opts.sinceHours ?? 72, 1), 720);
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 20);
  const since = new Date(Date.now() - sinceHours * 3600 * 1000);
  const ticker = opts.ticker?.trim().toUpperCase();

  const rows = await prisma.newsItem.findMany({
    where: {
      publishedAt: { gte: since },
      AND: [
        { tickers: { some: {} } },
        ...(ticker
          ? [
              {
                tickers: {
                  some: { ticker: { contains: ticker, mode: "insensitive" as const } },
                },
              },
            ]
          : []),
      ],
    },
    select: {
      title: true,
      url: true,
      publisher: true,
      publishedAt: true,
      category: true,
      excerpt: true,
      portfolioPct: true,
      source: { select: { name: true } },
      tickers: { select: { ticker: true }, orderBy: { confidence: "desc" } },
    },
    orderBy: [{ relevanceScore: "desc" }, { publishedAt: "desc" }],
    take: limit,
  });

  return {
    generatedAt: new Date().toISOString(),
    items: rows.map((row) => ({
      title: row.title,
      url: row.url,
      publisher: row.publisher,
      sourceName: row.source.name,
      publishedAt: row.publishedAt.toISOString(),
      category: row.category,
      excerpt: row.excerpt,
      portfolioPct: row.portfolioPct,
      tickers: row.tickers.map((t) => t.ticker),
    })),
  };
}

