import { NextResponse } from "next/server";
import {
  getLatestQuotesFetchedAt,
  quotesAreStale,
  refreshLiveQuotesForLatestImport,
} from "@/features/portfolio/refresh-live-quotes";

export async function POST(request: Request) {
  try {
    const maxAgeMinutes = Number(new URL(request.url).searchParams.get("maxAgeMinutes") ?? "0");
    if (maxAgeMinutes > 0) {
      const quotesAsOf = await getLatestQuotesFetchedAt();
      if (!quotesAreStale(quotesAsOf, maxAgeMinutes)) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          quotesAsOf: quotesAsOf!.toISOString(),
          quotesUpserted: 0,
          quotesMissing: 0,
          positionsConsidered: 0,
          yahooSymbolsRequested: 0,
          stooqFilled: 0,
          missingYahooSymbols: [],
          fetchedAt: quotesAsOf!.toISOString(),
        });
      }
    }

    const result = await refreshLiveQuotesForLatestImport();
    return NextResponse.json(result);
  } catch (cause) {
    return NextResponse.json(
      {
        ok: false,
        message:
          cause instanceof Error ? cause.message : "Échec du rafraîchissement des cours.",
      },
      { status: 500 },
    );
  }
}
