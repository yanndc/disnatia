-- Fil de nouvelles d'investissement :
-- 1) sources déclarées (RSS éditorial + flux auto par titre détenu)
-- 2) articles ingérés, dédupliqués par URL canonique et empreinte de titre
-- 3) rattachement article → titre du portefeuille (score + exposition $)
-- 4) journal d'exécution du cron

CREATE TYPE "NewsCategory" AS ENUM ('MARKETS', 'COMPANY', 'ECONOMY', 'REAL_ESTATE', 'PERSONAL_FINANCE', 'OTHER');
CREATE TYPE "NewsSourceKind" AS ENUM ('RSS', 'AUTO_TICKER');

CREATE TABLE "news_sources" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "feedUrl" TEXT NOT NULL,
  "homepageUrl" TEXT,
  "kind" "NewsSourceKind" NOT NULL DEFAULT 'RSS',
  "language" TEXT NOT NULL DEFAULT 'fr',
  "category" "NewsCategory" NOT NULL DEFAULT 'OTHER',
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isSeed" BOOLEAN NOT NULL DEFAULT false,
  "lastFetchedAt" TIMESTAMP(3),
  "lastStatus" TEXT,
  "lastError" TEXT,
  "lastItemCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "news_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "news_sources_slug_key" ON "news_sources"("slug");
CREATE INDEX "news_sources_isActive_idx" ON "news_sources"("isActive");

CREATE TABLE "news_items" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "excerpt" TEXT,
  "publisher" TEXT,
  "imageUrl" TEXT,
  "author" TEXT,
  "language" TEXT NOT NULL DEFAULT 'fr',
  "category" "NewsCategory" NOT NULL DEFAULT 'OTHER',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "publishedAt" TIMESTAMP(3) NOT NULL,
  "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "relevanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "portfolioPct" DOUBLE PRECISION,
  "portfolioValueCad" DOUBLE PRECISION,
  "readAt" TIMESTAMP(3),
  "savedAt" TIMESTAMP(3),
  CONSTRAINT "news_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "news_items_canonicalUrl_key" ON "news_items"("canonicalUrl");
CREATE UNIQUE INDEX "news_items_fingerprint_key" ON "news_items"("fingerprint");
CREATE INDEX "news_items_publishedAt_relevanceScore_idx" ON "news_items"("publishedAt", "relevanceScore");
CREATE INDEX "news_items_publishedAt_idx" ON "news_items"("publishedAt");
CREATE INDEX "news_items_category_publishedAt_idx" ON "news_items"("category", "publishedAt");
CREATE INDEX "news_items_sourceId_publishedAt_idx" ON "news_items"("sourceId", "publishedAt");

ALTER TABLE "news_items"
  ADD CONSTRAINT "news_items_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "news_sources"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "news_item_tickers" (
  "id" TEXT NOT NULL,
  "newsItemId" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "yahooSymbol" TEXT,
  "matchKind" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "news_item_tickers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "news_item_tickers_newsItemId_ticker_key" ON "news_item_tickers"("newsItemId", "ticker");
CREATE INDEX "news_item_tickers_ticker_idx" ON "news_item_tickers"("ticker");

ALTER TABLE "news_item_tickers"
  ADD CONSTRAINT "news_item_tickers_newsItemId_fkey"
  FOREIGN KEY ("newsItemId") REFERENCES "news_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "news_ingestion_runs" (
  "id" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "sourcesOk" INTEGER NOT NULL DEFAULT 0,
  "sourcesFailed" INTEGER NOT NULL DEFAULT 0,
  "itemsSeen" INTEGER NOT NULL DEFAULT 0,
  "itemsCreated" INTEGER NOT NULL DEFAULT 0,
  "itemsUpdated" INTEGER NOT NULL DEFAULT 0,
  "errorSummary" JSONB,
  CONSTRAINT "news_ingestion_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "news_ingestion_runs_startedAt_idx" ON "news_ingestion_runs"("startedAt");
