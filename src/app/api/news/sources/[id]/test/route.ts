import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { previewNewsFeed } from "@/features/news/ingest-news";
import { loadNewsPortfolioContext } from "@/features/news/news-portfolio";
import { autoTickerFeedUrl } from "@/features/news/news-sources";

export const maxDuration = 60;

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Teste un flux sans écrire en base : renvoie le nombre d'entrées lues et quelques titres.
 * Les flux `AUTO_TICKER` sont testés avec le premier titre du portefeuille.
 */
export async function POST(_request: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Identifiant manquant." }, { status: 400 });
  }

  const source = await prisma.newsSource.findUnique({
    where: { id },
    select: { feedUrl: true, kind: true, name: true },
  });
  if (!source) {
    return NextResponse.json({ error: "Source introuvable." }, { status: 404 });
  }

  let url = source.feedUrl;
  if (source.kind === "AUTO_TICKER") {
    const portfolio = await loadNewsPortfolioContext();
    const first = portfolio.tickers.find((ticker) => ticker.yahooSymbol && ticker.valueCad > 0);
    if (!first) {
      return NextResponse.json(
        { ok: false, itemCount: 0, entries: [], error: "Aucun titre en portefeuille à tester." },
        { status: 200 },
      );
    }
    url = autoTickerFeedUrl(first.yahooSymbol);
  }

  const preview = await previewNewsFeed(url);
  return NextResponse.json({ ...preview, testedUrl: url, sourceName: source.name });
}
