import type { NewsCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  buildExcerpt,
  canonicalizeUrl,
  classifyCategory,
  guessLanguage,
  isNoisyFeedTitle,
  stripPublisherSuffix,
  titleFingerprint,
} from "./normalize";
import {
  buildTickerIndex,
  matchTickersInEntry,
  type TickerIndexEntry,
  type TickerMatch,
} from "./ticker-matcher";
import { computeRelevanceScore } from "./relevance";
import { loadNewsPortfolioContext } from "./news-portfolio";
import {
  AUTO_TICKER_MAX_SYMBOLS,
  autoTickerFeedUrl,
  ensureNewsSourcesSeeded,
} from "./news-sources";
import { parseFeedXml } from "./rss-parser";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_ITEMS_PER_RUN = 400;
const MAX_ITEM_AGE_DAYS = 14;
const RETENTION_DAYS = 120;
const FEED_CONCURRENCY = 4;
const USER_AGENT = "Mozilla/5.0 (compatible; DisnatIA/1.0; +https://github.com/)";

export type NewsIngestionError = { source: string; message: string };

export type NewsIngestionResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sourcesOk: number;
  sourcesFailed: number;
  /** Articles lus dans les flux (avant déduplication). */
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsPruned: number;
  /** Titres du portefeuille suivis pour le rattachement. */
  portfolioTickers: number;
  errors: NewsIngestionError[];
};

type FeedJob = {
  sourceId: string;
  sourceName: string;
  sourceSlug: string;
  language: string;
  category: NewsCategory;
  weight: number;
  url: string;
};

type PreparedEntry = {
  job: FeedJob;
  title: string;
  url: string;
  canonicalUrl: string;
  fingerprint: string;
  excerpt: string | null;
  publisher: string | null;
  imageUrl: string | null;
  author: string | null;
  language: string;
  category: NewsCategory;
  publishedAt: Date;
  matches: TickerMatch[];
  portfolioPct: number | null;
  portfolioValueCad: number | null;
  relevanceScore: number;
};

async function fetchFeedXml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      "Accept-Language": "fr-CA,fr;q=0.9,en;q=0.8",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const text = await response.text();
  if (!/<(rss|feed|rdf:RDF)\b/i.test(text.slice(0, 4000))) {
    throw new Error("Réponse non XML (flux indisponible ou bloqué)");
  }
  return text;
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(lanes);
  return results;
}

function buildFeedJobs(
  sources: Array<{
    id: string;
    slug: string;
    name: string;
    feedUrl: string;
    language: string;
    category: NewsCategory;
    weight: number;
    kind: "RSS" | "AUTO_TICKER";
  }>,
  index: TickerIndexEntry[],
): FeedJob[] {
  const jobs: FeedJob[] = [];
  for (const source of sources) {
    if (source.kind === "AUTO_TICKER") {
      const symbols = [
        ...new Set(
          index
            .filter((t) => t.yahooSymbol && t.valueCad > 0)
            .slice(0, AUTO_TICKER_MAX_SYMBOLS)
            .map((t) => t.yahooSymbol),
        ),
      ];
      for (const symbol of symbols) {
        jobs.push({
          sourceId: source.id,
          sourceName: source.name,
          sourceSlug: source.slug,
          language: source.language,
          category: source.category,
          weight: source.weight,
          url: autoTickerFeedUrl(symbol),
        });
      }
      continue;
    }
    jobs.push({
      sourceId: source.id,
      sourceName: source.name,
      sourceSlug: source.slug,
      language: source.language,
      category: source.category,
      weight: source.weight,
      url: source.feedUrl,
    });
  }
  return jobs;
}

function prepareEntry(
  job: FeedJob,
  raw: {
    title: string;
    url: string;
    summary?: string;
    publisher?: string;
    author?: string;
    imageUrl?: string;
    publishedAt?: Date;
  },
  index: TickerIndexEntry[],
  totalCad: number,
  now: Date,
): PreparedEntry | null {
  const publisher = raw.publisher?.trim() || null;
  const title = stripPublisherSuffix(raw.title, publisher);
  if (title.length < 12) return null;
  if (isNoisyFeedTitle(title)) return null;

  const canonicalUrl = canonicalizeUrl(raw.url);
  if (!canonicalUrl) return null;

  const publishedAt = raw.publishedAt ?? now;
  const ageMs = now.getTime() - publishedAt.getTime();
  if (ageMs > MAX_ITEM_AGE_DAYS * 24 * 3600 * 1000) return null;
  if (ageMs < -24 * 3600 * 1000) return null; // date dans le futur : flux suspect

  const excerpt = buildExcerpt(title, raw.summary);
  const haystack = `${title} ${excerpt ?? ""}`;
  const matches = matchTickersInEntry({ title, excerpt, publisher }, index);
  const exposureValue = matches.reduce((sum, m) => sum + m.valueCad, 0);
  const portfolioPctRaw = totalCad > 0 ? (exposureValue / totalCad) * 100 : 0;
  const portfolioPct = matches.length > 0 ? Math.round(portfolioPctRaw * 100) / 100 : null;
  const matchConfidence = matches.reduce((max, m) => Math.max(max, m.confidence), 0);
  const category = classifyCategory(haystack, job.category);
  const hoursOld = Math.max(0, ageMs / 3_600_000);

  return {
    job,
    title,
    url: raw.url,
    canonicalUrl,
    fingerprint: titleFingerprint(title, canonicalUrl),
    excerpt,
    publisher,
    imageUrl: raw.imageUrl ?? null,
    author: raw.author ?? null,
    language: guessLanguage(haystack, job.language),
    category,
    publishedAt,
    matches,
    portfolioPct,
    portfolioValueCad:
      matches.length > 0 ? Math.round(exposureValue * 100) / 100 : null,
    relevanceScore: computeRelevanceScore({
      exposurePct: portfolioPct ?? 0,
      hoursOld,
      matchConfidence,
      sourceWeight: job.weight,
      category,
    }),
  };
}

type FeedJobOutcome = {
  job: FeedJob;
  ok: boolean;
  itemCount: number;
  error: string | null;
  entries: PreparedEntry[];
};

async function runFeedJob(
  job: FeedJob,
  index: TickerIndexEntry[],
  totalCad: number,
  now: Date,
): Promise<FeedJobOutcome> {
  try {
    const xml = await fetchFeedXml(job.url);
    const parsed = parseFeedXml(xml);
    const entries: PreparedEntry[] = [];
    for (const entry of parsed.entries) {
      const prepared = prepareEntry(
        job,
        {
          title: entry.title,
          url: entry.url,
          summary: entry.summary ?? entry.contentHtml,
          publisher: entry.publisher,
          author: entry.author,
          imageUrl: entry.imageUrl,
          publishedAt: entry.publishedAt,
        },
        index,
        totalCad,
        now,
      );
      if (prepared) entries.push(prepared);
    }
    return { job, ok: true, itemCount: parsed.entries.length, error: null, entries };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Échec de lecture du flux";
    return { job, ok: false, itemCount: 0, error: message.slice(0, 300), entries: [] };
  }
}

async function persistEntries(
  entries: PreparedEntry[],
): Promise<{ created: number; updated: number; unchanged: number }> {
  if (entries.length === 0) return { created: 0, updated: 0, unchanged: 0 };

  const existing = await prisma.newsItem.findMany({
    where: {
      OR: [
        { canonicalUrl: { in: entries.map((e) => e.canonicalUrl) } },
        { fingerprint: { in: entries.map((e) => e.fingerprint) } },
      ],
    },
    select: {
      id: true,
      canonicalUrl: true,
      fingerprint: true,
      relevanceScore: true,
      portfolioPct: true,
      category: true,
      tickers: { select: { ticker: true } },
    },
  });
  const byCanonical = new Map(existing.map((row) => [row.canonicalUrl, row]));
  const byFingerprint = new Map(existing.map((row) => [row.fingerprint, row]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const entry of entries) {
    const existingRow =
      byCanonical.get(entry.canonicalUrl) ?? byFingerprint.get(entry.fingerprint);

    if (existingRow) {
      const existingTickers = new Set(existingRow.tickers.map((t) => t.ticker));
      const sameTickers =
        existingTickers.size === entry.matches.length &&
        entry.matches.every((match) => existingTickers.has(match.ticker));
      const sameScore = Math.abs(existingRow.relevanceScore - entry.relevanceScore) < 0.5;
      const samePct =
        Math.abs((existingRow.portfolioPct ?? 0) - (entry.portfolioPct ?? 0)) < 0.1;
      if (sameTickers && sameScore && samePct && existingRow.category === entry.category) {
        unchanged += 1;
        continue;
      }

      // Les correspondances sont recalculées à chaque passage : on remplace les rattachements
      // pour que les corrections de matching s'appliquent aussi aux articles déjà en base.
      await prisma.newsItem
        .update({
          where: { id: existingRow.id },
          data: {
            relevanceScore: entry.relevanceScore,
            portfolioPct: entry.portfolioPct,
            portfolioValueCad: entry.portfolioValueCad,
            category: entry.category,
            excerpt: entry.excerpt,
            tags: entry.matches.map((m) => m.displayTicker),
            tickers: {
              deleteMany: {},
              create: entry.matches.map((match) => ({
                ticker: match.ticker,
                yahooSymbol: match.yahooSymbol,
                matchKind: match.matchKind,
                confidence: match.confidence,
              })),
            },
          },
        })
        .catch(() => null);
      updated += 1;
      continue;
    }

    try {
      const row = await prisma.newsItem.create({
        data: {
          sourceId: entry.job.sourceId,
          url: entry.url,
          canonicalUrl: entry.canonicalUrl,
          fingerprint: entry.fingerprint,
          title: entry.title,
          excerpt: entry.excerpt,
          publisher: entry.publisher,
          imageUrl: entry.imageUrl,
          author: entry.author,
          language: entry.language,
          category: entry.category,
          tags: entry.matches.map((m) => m.displayTicker),
          publishedAt: entry.publishedAt,
          relevanceScore: entry.relevanceScore,
          portfolioPct: entry.portfolioPct,
          portfolioValueCad: entry.portfolioValueCad,
          tickers: {
            create: entry.matches.map((match) => ({
              ticker: match.ticker,
              yahooSymbol: match.yahooSymbol,
              matchKind: match.matchKind,
              confidence: match.confidence,
            })),
          },
        },
        select: { id: true },
      });
      byCanonical.set(entry.canonicalUrl, {
        id: row.id,
        canonicalUrl: entry.canonicalUrl,
        fingerprint: entry.fingerprint,
        relevanceScore: entry.relevanceScore,
        portfolioPct: entry.portfolioPct,
        category: entry.category,
        tickers: entry.matches.map((match) => ({ ticker: match.ticker })),
      });
      byFingerprint.set(entry.fingerprint, {
        id: row.id,
        canonicalUrl: entry.canonicalUrl,
        fingerprint: entry.fingerprint,
        relevanceScore: entry.relevanceScore,
        portfolioPct: entry.portfolioPct,
        category: entry.category,
        tickers: entry.matches.map((match) => ({ ticker: match.ticker })),
      });
      created += 1;
    } catch {
      // Collision unique (deux crons concurrents) : ligne déjà connue.
      updated += 1;
    }
  }

  return { created, updated, unchanged };
}

async function updateSourceStatuses(
  outcomes: FeedJobOutcome[],
  now: Date,
): Promise<{ sourcesOk: number; sourcesFailed: number }> {
  const bySource = new Map<
    string,
    { ok: number; failed: number; items: number; error: string | null }
  >();
  for (const outcome of outcomes) {
    const bucket =
      bySource.get(outcome.job.sourceId) ??
      { ok: 0, failed: 0, items: 0, error: null as string | null };
    if (outcome.ok) {
      bucket.ok += 1;
      bucket.items += outcome.entries.length;
    } else {
      bucket.failed += 1;
      bucket.error ??= outcome.error;
    }
    bySource.set(outcome.job.sourceId, bucket);
  }

  let sourcesOk = 0;
  let sourcesFailed = 0;
  for (const [sourceId, bucket] of bySource) {
    const status = bucket.failed > 0 && bucket.ok === 0 ? "ERROR" : "OK";
    if (status === "OK") sourcesOk += 1;
    else sourcesFailed += 1;
    await prisma.newsSource
      .update({
        where: { id: sourceId },
        data: {
          lastFetchedAt: now,
          lastStatus: status,
          lastError: bucket.failed > 0 ? bucket.error : null,
          lastItemCount: bucket.items,
        },
      })
      .catch(() => null);
  }
  return { sourcesOk, sourcesFailed };
}

/**
 * Ingestion complète : seed des sources, lecture des flux, déduplication,
 * rattachement portefeuille, scoring, persistance et purge.
 * Idempotent : relancer ne crée pas de doublon (clés `canonicalUrl` / `fingerprint`).
 */
export async function runNewsIngestion(
  options: { now?: Date } = {},
): Promise<NewsIngestionResult> {
  const now = options.now ?? new Date();
  const startedAt = new Date();
  const run = await prisma.newsIngestionRun.create({
    data: { startedAt },
    select: { id: true },
  });

  try {
    await ensureNewsSourcesSeeded();
    const portfolio = await loadNewsPortfolioContext();
    const index = buildTickerIndex(portfolio.tickers);
    const sources = await prisma.newsSource.findMany({
      where: { isActive: true },
      select: {
        id: true,
        slug: true,
        name: true,
        feedUrl: true,
        language: true,
        category: true,
        weight: true,
        kind: true,
      },
    });

    const jobs = buildFeedJobs(sources, index);
    const outcomes = await runWithConcurrency(jobs, FEED_CONCURRENCY, (job) =>
      runFeedJob(job, index, portfolio.totalCad, now),
    );

    const errors: NewsIngestionError[] = outcomes
      .filter((outcome) => !outcome.ok)
      .map((outcome) => ({
        source: outcome.job.sourceSlug,
        message: outcome.error ?? "Erreur inconnue",
      }));
    const itemsSeen = outcomes.reduce((sum, outcome) => sum + outcome.itemCount, 0);

    const byCanonical = new Map<string, PreparedEntry>();
    for (const outcome of outcomes) {
      for (const entry of outcome.entries) {
        const current = byCanonical.get(entry.canonicalUrl);
        if (!current || entry.relevanceScore > current.relevanceScore) {
          byCanonical.set(entry.canonicalUrl, entry);
        }
      }
    }
    const byFingerprint = new Map<string, PreparedEntry>();
    for (const entry of byCanonical.values()) {
      const current = byFingerprint.get(entry.fingerprint);
      if (!current || entry.relevanceScore > current.relevanceScore) {
        byFingerprint.set(entry.fingerprint, entry);
      }
    }
    const prepared = [...byFingerprint.values()]
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, MAX_ITEMS_PER_RUN);

    const { created, updated, unchanged } = await persistEntries(prepared);
    const { sourcesOk, sourcesFailed } = await updateSourceStatuses(outcomes, now);

    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 3600 * 1000);
    const pruned = await prisma.newsItem
      .deleteMany({ where: { publishedAt: { lt: cutoff }, savedAt: null } })
      .catch(() => ({ count: 0 }));

    // Purge du bruit de flux déjà en base (titres de type « ETF Activity », « Pre-Bell »).
    const noiseWindow = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const noiseCandidates = await prisma.newsItem
      .findMany({
        where: { publishedAt: { gte: noiseWindow }, savedAt: null },
        select: { id: true, title: true },
      })
      .catch(() => [] as { id: string; title: string }[]);
    const noiseIds = noiseCandidates
      .filter((row) => isNoisyFeedTitle(row.title))
      .map((row) => row.id);
    const noisePruned =
      noiseIds.length > 0
        ? await prisma.newsItem
            .deleteMany({ where: { id: { in: noiseIds }, savedAt: null } })
            .catch(() => ({ count: 0 }))
        : { count: 0 };

    const finishedAt = new Date();
    const result: NewsIngestionResult = {
      ok: errors.length === 0 || prepared.length > 0,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      sourcesOk,
      sourcesFailed,
      itemsSeen,
      itemsCreated: created,
      itemsUpdated: updated,
      itemsUnchanged: unchanged,
      itemsPruned: pruned.count + noisePruned.count,
      portfolioTickers: index.length,
      errors,
    };

    await prisma.newsIngestionRun
      .update({
        where: { id: run.id },
        data: {
          finishedAt,
          status: result.ok ? "COMPLETED" : "FAILED",
          sourcesOk,
          sourcesFailed,
          itemsSeen,
          itemsCreated: created,
          itemsUpdated: updated,
          errorSummary: errors.length > 0 ? errors : undefined,
        },
      })
      .catch(() => null);

    return result;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Échec de l'ingestion";
    await prisma.newsIngestionRun
      .update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          status: "FAILED",
          errorSummary: [{ source: "ingestion", message }],
        },
      })
      .catch(() => null);
    throw cause;
  }
}

/** Test d'un flux depuis l'admin : lit et parse sans rien écrire en base. */
export async function previewNewsFeed(url: string): Promise<{
  ok: boolean;
  itemCount: number;
  feedTitle?: string;
  entries: { title: string; url: string; publishedAt: string | null }[];
  error?: string;
}> {
  try {
    const xml = await fetchFeedXml(url);
    const parsed = parseFeedXml(xml);
    return {
      ok: true,
      itemCount: parsed.entries.length,
      feedTitle: parsed.feedTitle,
      entries: parsed.entries.slice(0, 5).map((entry) => ({
        title: entry.title,
        url: entry.url,
        publishedAt: entry.publishedAt?.toISOString() ?? null,
      })),
    };
  } catch (cause) {
    return {
      ok: false,
      itemCount: 0,
      entries: [],
      error: cause instanceof Error ? cause.message : "Flux illisible",
    };
  }
}

